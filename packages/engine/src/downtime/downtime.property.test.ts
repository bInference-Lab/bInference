import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import { bpsSchema, type Id } from "@binference/core";
import type { ManualClock } from "@binference/core/testing";
import type { OrderRequest } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import type { WatchedOrderPrice } from "../orders/order-triggers.js";
import { activeOrder, fillRowsOf, startFillEngine, wholeToken } from "../orders/test-fills.js";
import { testStopLoss } from "../orders/test-orders.js";

const live = { signal: new AbortController().signal };
const hourMs = 3_600_000;
// The test coin at $600: micro-dollars for one of its base units.
const coinUsd = { numerator: 600n, denominator: 10n ** 12n };
// A venue's quote takes this long, so a fill can still run when a pause comes.
const quoteMs = 1_000;

/** One sale order of the case: its kind, trigger price and worst price, in micro-dollars. */
interface CaseOrder {
  readonly kind: "stopLoss" | "takeProfit";
  readonly triggerMicros: bigint;
  readonly worstMicros: bigint;
}

/**
 * One step of the case: a price handed on, read this long before or after the clock's time now,
 * or a pause of the engine this long, which the first fence question after it finds.
 */
type CaseStep =
  | { readonly kind: "price"; readonly micros: bigint; readonly readOffsetMs: number }
  | { readonly kind: "pause"; readonly pauseMs: number };

const micros = fc.bigInt({ min: 400_000n, max: 1_600_000n });
const caseOrders: fc.Arbitrary<readonly CaseOrder[]> = fc.array(
  fc.record({
    kind: fc.constantFrom("stopLoss" as const, "takeProfit" as const),
    triggerMicros: micros,
    worstMicros: fc.bigInt({ min: 500_000n, max: 1_100_000n }),
  }),
  { minLength: 1, maxLength: 3 },
);
const caseSteps: fc.Arbitrary<readonly CaseStep[]> = fc.array(
  fc.oneof(
    fc.record({
      kind: fc.constant("price" as const),
      micros,
      readOffsetMs: fc.integer({ min: -hourMs, max: 2_000 }),
    }),
    fc.record({
      kind: fc.constant("pause" as const),
      pauseMs: fc.integer({ min: 61_000, max: hourMs }),
    }),
  ),
  { minLength: 1, maxLength: 8 },
);
// What the venue pays a token's sale: micro-dollars a whole token, $0.60 to $1.00.
const venueMicros = fc.bigInt({ min: 600_000n, max: 1_000_000n });

// Coin base units for one token base unit at `usdMicros` a whole token of 6 decimals.
function rateOf(usdMicros: bigint) {
  return {
    numerator: usdMicros * coinUsd.denominator,
    denominator: wholeToken * coinUsd.numerator,
  };
}

// The fake venue at a rate, whose quotes wait on the test's clock once it is handed one.
function slowVenue(usdMicros: bigint, waits: { readonly clock?: ManualClock }): Venue {
  const venue = createFakeVenue({ rate: rateOf(usdMicros) });
  return {
    ...venue,
    quote: async (request, call) => {
      await waits.clock?.sleep(quoteMs, call.signal);
      return venue.quote(request, call);
    },
  };
}

function requestOf(order: CaseOrder): OrderRequest {
  const share = { percentBps: bpsSchema.parse(2_000) };
  return {
    ...testStopLoss({ size: share, worstPrice: order.worstMicros }),
    kind: order.kind,
    trigger: { price: order.triggerMicros },
  };
}

function priceOf(step: { readonly micros: bigint; readonly readAtMs: number }): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: step.micros, denominator: wholeToken },
    decimals: 6,
    isThin: false,
    readAtMs: step.readAtMs,
  };
}

/** A filled order's fill: when its trigger's price was read, its quote and when it filled. */
interface Filled {
  readonly readAtMs: number;
  readonly worstMicros: bigint;
  readonly paidMicrosEnough: boolean;
  readonly filledAtMs: number;
}

// Each fill of the orders, with the price that fired it and whether its quote held its worst price.
async function fillsOf(
  test: TestEngine,
  fired: ReadonlyMap<Id<"ord">, number>,
  orders: readonly { readonly order: Id<"ord">; readonly worstMicros: bigint }[],
): Promise<readonly Filled[]> {
  const filled = await Promise.all(
    orders.map(async ({ order, worstMicros }) => {
      const rows = (await fillRowsOf(test, order)).filter(({ outcome }) => outcome === "filled");
      return Promise.all(
        rows.map(async ({ intentId }) => {
          const intent =
            intentId === undefined ? undefined : await test.stores.intents.get(intentId, live);
          const quote = quoteDocument.decode(intent?.quote ?? null);
          // minOut coin base × coin price ≥ worst × amountIn token base / one whole token.
          const paid = quote.minOut.base * coinUsd.numerator * wholeToken;
          const wanted = worstMicros * quote.amountIn.base * coinUsd.denominator;
          // A fill no handed price fired counts as one on the oldest price there is.
          const readAtMs = fired.get(order) ?? Math.max();
          return {
            readAtMs,
            worstMicros,
            paidMicrosEnough: paid >= wanted,
            filledAtMs: intent?.changedAtMs ?? 0,
          };
        }),
      );
    }),
  );
  return filled.flat();
}

// Moves the clock a second at a time until every price handed on has ended, at most ten minutes.
async function advanceUntil(clock: ManualClock, done: { readonly all: boolean }, leftMs = 600_000) {
  if (!done.all && leftMs > 0) {
    await clock.advance(quoteMs);
    await advanceUntil(clock, done, leftMs - quoteMs);
  }
}

// The latest pause that began before `atMs`.
const resumeBefore = (resumes: readonly number[], atMs: number): number =>
  Math.max(...resumes.filter((resumeMs) => resumeMs < atMs));

/** What a case's steps came to: each filled order's price read time, and when each pause began. */
interface StepsRun {
  readonly fired: ReadonlyMap<Id<"ord">, number>;
  readonly resumes: readonly number[];
}

// Runs the case's steps on the engine: each price handed on and left to run, each pause found by
// whoever asks the fence first, else by the timer's tick after it, as the composition root does.
async function runSteps(test: TestEngine, steps: readonly CaseStep[]): Promise<StepsRun> {
  const pending: { pause?: { readonly fromMs: number; readonly offMs: number } } = {};
  const findPause = (): boolean => {
    const { pause } = pending;
    delete pending.pause;
    if (pause !== undefined) {
      void test.engine.downtime.paused({ cause: "wake", ...pause }, live);
    }
    return pause !== undefined;
  };
  test.engine.downtime.findPausesWith(findPause);
  const fired = new Map<Id<"ord">, number>();
  const resumes: number[] = [];
  const handed: Promise<void>[] = [];
  for (const step of steps) {
    if (step.kind === "pause") {
      // The machine sleeps from now: whatever runs after this ran after the pause.
      resumes.push(test.clock.now());
      pending.pause = { fromMs: test.clock.now(), offMs: step.pauseMs };
      // oxlint-disable-next-line eslint/no-await-in-loop -- a fill under way goes on after the pause
      await test.clock.advance(step.pauseMs);
      findPause();
    } else {
      const readAtMs = test.clock.now() + step.readOffsetMs;
      const seen = test.engine.seePrice(priceOf({ micros: step.micros, readAtMs }), live);
      handed.push(
        seen.then((outcomes) => {
          const filled = outcomes.filter(({ outcome }) => outcome === "filled");
          filled.forEach(({ order }) => fired.set(order, readAtMs));
          return undefined;
        }),
      );
      // oxlint-disable-next-line eslint/no-await-in-loop -- lets the fill start before the next step
      await test.clock.advance(100);
    }
  }
  const done = { all: false };
  void Promise.all(handed).then(() => {
    done.all = true;
    return undefined;
  });
  await advanceUntil(test.clock, done);
  return { fired, resumes };
}

describe("the downtime re-check, for every order, price, pause and fill under way", () => {
  it("never fills on a price read before the resume in effect, nor past an order's worst price", async () => {
    await fc.assert(
      fc.asyncProperty(caseOrders, caseSteps, venueMicros, async (orders, steps, venue) => {
        const waits: { clock?: ManualClock } = {};
        const venues = [slowVenue(venue, waits)];
        const test = await startFillEngine({ venues, tokens: 10n * wholeToken });
        const made = await Promise.all(
          orders.map(async (order) => ({
            order: (await activeOrder(test, requestOf(order))).id,
            worstMicros: order.worstMicros,
          })),
        );
        waits.clock = test.clock;
        const { fired, resumes } = await runSteps(test, steps);

        const fills = await fillsOf(test, fired, made);
        expect(
          fills.every(({ readAtMs, filledAtMs }) => readAtMs >= resumeBefore(resumes, filledAtMs)),
        ).toBe(true);
        expect(fills.every(({ paidMicrosEnough }) => paidMicrosEnough)).toBe(true);
      }),
      { numRuns: 80 },
    );
  });
});
