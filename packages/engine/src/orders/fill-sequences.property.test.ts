import { createFakeVenue } from "@binference/chain/testing";
import { type Bps, bpsPerWhole } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testNowMs, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import type { WatchedOrderPrice } from "./order-triggers.js";
import { activeOrder, fillIntentsOf, startFillEngine, wholeToken } from "./test-fills.js";
import { storedOrder, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

type SequenceKind = "stopLoss" | "takeProfit" | "limitSell" | "trailing";

/** One price the watcher confirmed, after a wait, in micro-dollars a whole token. */
interface Step {
  readonly waitMs: number;
  readonly micros: bigint;
}

interface Sequence {
  readonly kind: SequenceKind;
  readonly distanceBps: number;
  readonly maxFills?: number;
  readonly lifeMs: number;
  readonly steps: readonly Step[];
}

// Sales of one whole token each: a stop-loss at $0.90, a take-profit and a limit sale at $1.00,
// or a trailing stop; the venue pays $1.20, so every quote meets its level.
function requestOf(sequence: Sequence): OrderRequest {
  const base = {
    ...testStopLoss({ expiresAt: testNowMs + sequence.lifeMs }),
    size: { base: wholeToken },
    ...(sequence.maxFills === undefined ? {} : { maxFills: sequence.maxFills }),
  };
  if (sequence.kind === "trailing") {
    return { ...base, kind: "trailing", trigger: { distanceBps: sequence.distanceBps as Bps } };
  }
  if (sequence.kind === "limitSell") {
    return { ...base, kind: "limit", trigger: { price: 1_000_000n, direction: "above" } };
  }
  return sequence.kind === "stopLoss"
    ? { ...base, kind: "stopLoss", trigger: { price: 900_000n } }
    : { ...base, kind: "takeProfit", trigger: { price: 1_000_000n } };
}

// Whether the order's condition holds at a price, a trailing stop's with the highest price since
// it last filled, this one included; worked out apart from the engine.
function holds(sequence: Sequence, micros: bigint, peak: bigint): boolean {
  if (sequence.kind === "trailing") {
    const kept = BigInt(bpsPerWhole - sequence.distanceBps);
    return micros * BigInt(bpsPerWhole) <= peak * kept;
  }
  return sequence.kind === "stopLoss" ? micros <= 900_000n : micros >= 1_000_000n;
}

// What each fill broke of the re-arm rule: it fired where its condition held, and, after an
// earlier fill, only once a price between them did not meet the condition (decision 0197).
function rearmViolations(sequence: Sequence, filledAt: readonly number[]): readonly string[] {
  return filledAt.flatMap((index, nth) => {
    const from = nth === 0 ? 0 : (filledAt[nth - 1] ?? 0) + 1;
    const between = sequence.steps.slice(from, index + 1);
    const peakOf = (upTo: number) =>
      between.slice(0, upTo + 1).reduce((top, { micros }) => (micros > top ? micros : top), 0n);
    const at = sequence.steps[index]?.micros ?? 0n;
    const fires = holds(sequence, at, peakOf(between.length - 1));
    const rearmed =
      nth === 0 ||
      between.slice(0, -1).some(({ micros }, k) => !holds(sequence, micros, peakOf(k)));
    return [
      ...(fires ? [] : [`fill ${String(nth)} where its condition did not hold`]),
      ...(rearmed ? [] : [`fill ${String(nth)} without a price that re-armed it`]),
    ];
  });
}

// The fills an order may make: as many as it names, else one.
function mostFillsOf(sequence: Sequence): number {
  return sequence.maxFills ?? 1;
}

// Feeds the prices in turn, each after its wait, and answers the steps at which the order filled.
async function run(test: TestEngine, sequence: Sequence): Promise<readonly number[]> {
  return sequence.steps.reduce<Promise<readonly number[]>>(async (before, step, index) => {
    const filledAt = await before;
    await test.clock.advance(step.waitMs);
    const price: WatchedOrderPrice = {
      token: testToken,
      usdPerBaseUnit: { numerator: step.micros, denominator: wholeToken },
      decimals: 6,
      isThin: false,
      readAtMs: 0,
    };
    const outcomes = await test.engine.seePrice(price, live);
    return outcomes.some(({ outcome }) => outcome === "filled") ? [...filledAt, index] : filledAt;
  }, Promise.resolve([]));
}

const sequences: fc.Arbitrary<Sequence> = fc.record(
  {
    kind: fc.constantFrom<SequenceKind>("stopLoss", "takeProfit", "limitSell", "trailing"),
    distanceBps: fc.integer({ min: 300, max: 3_000 }),
    maxFills: fc.integer({ min: 1, max: 3 }),
    lifeMs: fc.integer({ min: 120_000, max: 600_000 }),
    steps: fc.array(
      fc.record({
        waitMs: fc.integer({ min: 0, max: 90_000 }),
        micros: fc.bigInt({ min: 500_000n, max: 1_500_000n }),
      }),
      { minLength: 1, maxLength: 10 },
    ),
  },
  { requiredKeys: ["kind", "distanceBps", "lifeMs", "steps"] },
);

// A venue that pays $1.20 a token; the wallet holds ten tokens.
async function engineFor(sequence: Sequence) {
  const rate = { numerator: 2n * 10n ** 9n, denominator: 1n };
  const test = await startFillEngine({
    venues: [createFakeVenue({ rate })],
    tokens: 10n * wholeToken,
  });
  const order = await activeOrder(test, requestOf(sequence));
  return { test, order };
}

describe("an order's fills over a run of confirmed prices, for every order and run", () => {
  it("fill at most their maximum, never after expiry, each re-armed, as the order counts them", async () => {
    await fc.assert(
      fc.asyncProperty(sequences, async (sequence) => {
        const { test, order } = await engineFor(sequence);
        const filledAt = await run(test, sequence);
        const fills = (await fillIntentsOf(test)).filter(({ state }) => state === "paper_filled");
        const after = await storedOrder(test, order.id);
        const late = fills.filter(({ changedAtMs }) => changedAtMs >= order.expiresAtMs);

        expect(filledAt.length).toBeLessThanOrEqual(mostFillsOf(sequence));
        expect([fills.length, after.fills, late.length]).toStrictEqual([
          filledAt.length,
          fills.length,
          0,
        ]);
        expect(rearmViolations(sequence, filledAt)).toStrictEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it("fills a trailing stop of two fills twice, once a new high re-armed it, so the check is not empty", async () => {
    const steps = [1_000_000n, 900_000n, 1_200_000n, 1_000_000n].map((micros) => ({
      waitMs: 1_000,
      micros,
    }));
    const sequence: Sequence = {
      kind: "trailing",
      distanceBps: 300,
      maxFills: 2,
      lifeMs: 600_000,
      steps,
    };
    const { test } = await engineFor(sequence);

    expect(await run(test, sequence)).toStrictEqual([1, 3]);
  });
});
