import { createFakeVenue } from "@binference/chain/testing";
import { bpsSchema, type Id } from "@binference/core";
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

/** One sale order of the case: its kind, trigger price and worst price, in micro-dollars. */
interface CaseOrder {
  readonly kind: "stopLoss" | "takeProfit";
  readonly triggerMicros: bigint;
  readonly worstMicros: bigint;
}

/** One price the watcher hands on: micro-dollars a whole token, read this long after the resume. */
interface CasePrice {
  readonly micros: bigint;
  readonly offsetMs: number;
}

const micros = fc.bigInt({ min: 400_000n, max: 1_600_000n });
const caseOrders: fc.Arbitrary<readonly CaseOrder[]> = fc.array(
  fc.record({
    kind: fc.constantFrom("stopLoss" as const, "takeProfit" as const),
    triggerMicros: micros,
    worstMicros: fc.bigInt({ min: 500_000n, max: 1_100_000n }),
  }),
  { minLength: 1, maxLength: 3 },
);
const casePrices: fc.Arbitrary<readonly CasePrice[]> = fc.array(
  fc.record({ micros, offsetMs: fc.integer({ min: -2 * hourMs, max: 60_000 }) }),
  { minLength: 1, maxLength: 6 },
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

function requestOf(order: CaseOrder): OrderRequest {
  const share = { percentBps: bpsSchema.parse(2_000) };
  return {
    ...testStopLoss({ size: share, worstPrice: order.worstMicros }),
    kind: order.kind,
    trigger: { price: order.triggerMicros },
  };
}

function priceOf(price: CasePrice, resumedAtMs: number): WatchedOrderPrice {
  return {
    token: testToken,
    usdPerBaseUnit: { numerator: price.micros, denominator: wholeToken },
    decimals: 6,
    isThin: false,
    readAtMs: resumedAtMs + price.offsetMs,
  };
}

// Whether a sale's quote at its minimum out pays at least `worstMicros` a whole token.
async function quoteHolds(
  test: TestEngine,
  call: { readonly order: Id<"ord">; readonly worstMicros: bigint },
): Promise<boolean> {
  const rows = await fillRowsOf(test, call.order);
  const filled = rows.filter(({ outcome }) => outcome === "filled");
  const intents = await Promise.all(
    filled.map(async ({ intentId }) =>
      intentId === undefined ? undefined : test.stores.intents.get(intentId, live),
    ),
  );
  return intents.every((intent) => {
    const quote = quoteDocument.decode(intent?.quote ?? null);
    // minOut coin base × coin price ≥ worst × amountIn token base / one whole token.
    const paid = quote.minOut.base * coinUsd.numerator * wholeToken;
    const wanted = call.worstMicros * quote.amountIn.base * coinUsd.denominator;
    return paid >= wanted;
  });
}

describe("the downtime re-check, for every order, price and time it was read", () => {
  it("fills nothing on a price read before the resume, nor past an order's worst price", async () => {
    await fc.assert(
      fc.asyncProperty(caseOrders, casePrices, venueMicros, async (orders, prices, venue) => {
        const venues = [createFakeVenue({ rate: rateOf(venue) })];
        const test = await startFillEngine({ venues, tokens: 10n * wholeToken });
        const bounded: readonly { readonly order: Id<"ord">; readonly worstMicros: bigint }[] =
          await Promise.all(
            orders.map(async (order) => ({
              order: (await activeOrder(test, requestOf(order))).id,
              worstMicros: order.worstMicros,
            })),
          );
        await test.engine.downtime.alive(live);
        await test.clock.advance(hourMs);
        const restarted = test.restart();
        const resumedAtMs = test.clock.now();
        const run = await restarted.downtime.started(live);

        const fired: { readonly readAtMs: number; readonly order: Id<"ord"> }[] = [];
        for (const price of prices) {
          const seen = priceOf(price, resumedAtMs);
          // oxlint-disable-next-line eslint/no-await-in-loop -- prices come one after the other
          const outcomes = await restarted.seePrice(seen, live);
          const filled = outcomes.filter(({ outcome }) => outcome === "filled");
          fired.push(...filled.map(({ order }) => ({ readAtMs: seen.readAtMs, order })));
        }
        await test.clock.advance(3 * 60_000);
        await run?.reported;

        expect(fired.every(({ readAtMs }) => readAtMs >= resumedAtMs)).toBe(true);
        const holds = await Promise.all(bounded.map(async (call) => quoteHolds(test, call)));
        expect(holds.every(Boolean)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});
