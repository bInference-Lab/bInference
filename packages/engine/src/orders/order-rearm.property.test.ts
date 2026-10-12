import { type Bps, bpsPerWhole, idSchema, type JsonValue, type Ratio } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testAgent, testWallet } from "../intents/test-intents.js";
import { moveOrder } from "./order-machine.js";
import type { OrderRecord } from "./order-record.js";
import { judgeTrigger, type TriggerJudgment, triggerStateDocument } from "./price-triggers.js";
import { testStopLoss } from "./test-orders.js";

const nowMs = 1_000;
const at = (micros: bigint): Ratio => ({ numerator: micros, denominator: 1n });

function limitOf(direction: "above" | "below"): OrderRequest {
  return { ...testStopLoss(), kind: "limit", trigger: { price: 1_000n, direction } };
}

function trailingOf(distance: number): OrderRequest {
  return { ...testStopLoss(), kind: "trailing", trigger: { distanceBps: distance as Bps } };
}

const requests: fc.Arbitrary<OrderRequest> = fc.oneof(
  fc.constantFrom("above" as const, "below" as const).map(limitOf),
  fc.constant({ ...testStopLoss(), kind: "takeProfit" as const, trigger: { price: 1_000n } }),
  fc.constant(testStopLoss({ trigger: { price: 1_000n } })),
  fc.integer({ min: 1, max: bpsPerWhole - 1 }).map(trailingOf),
);

const prices: fc.Arbitrary<readonly Ratio[]> = fc.array(
  fc.bigInt({ min: 1n, max: 2_000n }).map(at),
  {
    minLength: 1,
    maxLength: 30,
  },
);

function orderOf(request: OrderRequest, maxFills: number): OrderRecord {
  return {
    id: idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    agentId: testAgent,
    walletId: testWallet,
    kind: request.kind,
    state: "active",
    request,
    fills: 0,
    maxFills,
    expiresAtMs: nowMs + 1_000_000,
    intentId: idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    cardId: idSchema("crd").parse("crd_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    isPaper: true,
    hasOutsideContent: false,
    createdAtMs: 1,
    changedAtMs: 1,
    version: 0,
  };
}

// `left` against `right` by cross-multiplying.
function sign(left: Ratio, right: Ratio): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  if (difference === 0n) {
    return 0;
  }
  return difference < 0n ? -1 : 1;
}

// Whether the condition holds, worked out apart from the module, with the oracle's peak.
function holds(request: OrderRequest, price: Ratio, peak: Ratio | undefined): boolean {
  if (request.kind === "trailing") {
    const top = peak === undefined || sign(price, peak) > 0 ? price : peak;
    const kept = BigInt(bpsPerWhole - request.trigger.distanceBps);
    return (
      price.numerator * top.denominator * BigInt(bpsPerWhole) <=
      top.numerator * price.denominator * kept
    );
  }
  if (request.kind === "limit") {
    const compared = sign(price, at(request.trigger.price));
    return request.trigger.direction === "above" ? compared >= 0 : compared <= 0;
  }
  const level = "price" in request.trigger ? request.trigger.price : 0n;
  const compared = sign(price, at(level));
  return request.kind === "takeProfit" ? compared >= 0 : compared <= 0;
}

/** The oracle: armed, the peak since it last armed, and the fills so far. */
interface Model {
  readonly isArmed: boolean;
  readonly peak?: Ratio;
  readonly fills: number;
}

function stepModel(
  model: Model,
  request: OrderRequest,
  price: Ratio,
): { model: Model; fires: boolean } {
  const fires = model.isArmed && holds(request, price, model.peak);
  const top = model.peak === undefined || sign(price, model.peak) > 0 ? price : model.peak;
  const kept = request.kind === "trailing" ? { peak: top } : {};
  if (fires) {
    return { model: { isArmed: false, fills: model.fills + 1 }, fires };
  }
  const isArmed = model.isArmed || !holds(request, price, model.peak);
  return { model: { ...kept, isArmed, fills: model.fills }, fires };
}

/** One run so far: the order as the engine keeps it, the oracle, and what fired and may have. */
interface Run {
  readonly order: OrderRecord;
  readonly model: Model;
  readonly fired: readonly boolean[];
  readonly allowed: readonly boolean[];
}

// The order after a judgment: its kept state, then its fill when it fired.
function orderAfter(order: OrderRecord, judged: TriggerJudgment | undefined): OrderRecord {
  const state: JsonValue | undefined =
    judged?.state === undefined ? order.triggerState : triggerStateDocument.encode(judged.state);
  const kept = state === undefined ? order : { ...order, triggerState: state };
  if (judged?.fires !== true) {
    return kept;
  }
  const move = moveOrder(kept, { type: "fill_recorded" }, nowMs);
  return move.ok ? { ...kept, ...move.value } : kept;
}

// One price through the trigger and the order machine, as the engine runs them, and the oracle.
function step(run: Run, price: Ratio): Run {
  const { order, model } = run;
  const isActive = order.state === "active";
  const judged = isActive ? judgeTrigger(order, price) : undefined;
  const stepped = stepModel(model, order.request, price);
  return {
    order: orderAfter(order, judged),
    model: isActive ? stepped.model : model,
    fired: [...run.fired, judged?.fires === true],
    allowed: [...run.allowed, isActive && stepped.fires],
  };
}

function runOf(request: OrderRequest, maxFills: number, sequence: readonly Ratio[]): Run {
  const start: Run = {
    order: orderOf(request, maxFills),
    model: { isArmed: true, fills: 0 },
    fired: [],
    allowed: [],
  };
  return sequence.reduce(step, start);
}

describe("an order's trigger after each fill, for every order and run of prices", () => {
  it("fires again only once its condition stopped holding, a trailing stop from a new peak", () => {
    fc.assert(
      fc.property(
        requests,
        fc.integer({ min: 1, max: 4 }),
        prices,
        (request, maxFills, sequence) => {
          const run = runOf(request, maxFills, sequence);
          expect(run.fired).toStrictEqual(run.allowed);
          expect(run.order.fills).toBeLessThanOrEqual(maxFills);
        },
      ),
      { numRuns: 3_000 },
    );
  });
});
