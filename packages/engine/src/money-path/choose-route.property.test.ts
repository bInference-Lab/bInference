import { createFakeVenue } from "@binference/chain/testing";
import { type Bps, bpsSchema, type Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createQuoteSimulator } from "../fakes/quote-simulator.js";
import { testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import { createVenueHost } from "../venues/venue-host.js";
import { chooseRoute } from "./choose-route.js";
import { quoteVenues } from "./quote-venues.js";
import type { SwapTrade } from "./swap-trade.js";
import { otherVenue, otherVenueId } from "./test-routes.js";

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const swap: SwapTrade = {
  trade: {
    venue: "fake-swap",
    wallet: testAccount,
    amountIn: { asset: testCoin, base: 1_000_000n },
    assetOut: testToken,
    maxSlippageBps: bpsSchema.parse(50),
  },
  venues: ["fake-swap", otherVenueId],
};
const bps = fc.integer({ min: 0, max: 10_000 }).map((value) => bpsSchema.parse(value));

interface Case {
  readonly impacts: readonly [Bps, Bps];
  readonly otherPerMillion: bigint;
  readonly max: Bps;
}

async function chooseFor({ impacts, otherPerMillion, max }: Case) {
  const clock = createManualClock(testNowMs);
  const [first, second] = impacts;
  const venues = [
    createFakeVenue({ priceImpactBps: first }),
    otherVenue({ numerator: otherPerMillion, denominator: 1_000_000n }, second),
  ];
  const host = createVenueHost({
    venues,
    chains: testChains([otherVenueId]),
    clock,
    callTimeoutMs: 5_000,
  });
  const signal = new AbortController().signal;
  const quotes = await quoteVenues(swap, { host, clock, signal });
  return chooseRoute(quotes, {
    swap,
    intent,
    host,
    simulator: createQuoteSimulator(() => undefined),
    prices: createFakePriceSource(new Map()),
    nativeAsset: testCoin,
    feePerGasBase: 1n,
    maxPriceImpactBps: max,
    signal,
  });
}

// Whether the choice ended with `price_impact`, and whether it chose a route above the maximum.
async function outcomeOf(input: Case) {
  const chosen = await chooseFor(input);
  return chosen.ok
    ? {
        isPriceImpact: false,
        isAboveMax: chosen.value.planned.built.quote.priceImpactBps > input.max,
      }
    : { isPriceImpact: chosen.error === "price_impact", isAboveMax: false };
}

describe("the best quote and the price impact limit", () => {
  it("never chooses a route above the maximum, and ends with price_impact only when all are", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          impacts: fc.tuple(bps, bps),
          otherPerMillion: fc.bigInt({ min: 1_000_000n, max: 3_000_000n }),
          max: bps,
        }),
        async (input: Case) => {
          const allAbove = input.impacts.every((impact) => impact > input.max);
          await expect(outcomeOf(input)).resolves.toStrictEqual({
            isPriceImpact: allAbove,
            isAboveMax: false,
          });
        },
      ),
      { numRuns: 60 },
    );
  });
});
