import { createFakeVenue } from "@binference/chain/testing";
import { bpsSchema, err, type Id, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createQuoteSimulator } from "../fakes/quote-simulator.js";
import { testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import type { PolicyVerdict } from "../policy/check-policy.js";
import type { Simulator } from "../ports.js";
import { createVenueHost, type QuoteOutcome, type TradeQuote } from "../venues/venue-host.js";
import { type ChosenRoute, chooseRoute, type RouteChoiceOptions } from "./choose-route.js";
import { quoteVenues } from "./quote-venues.js";
import type { SwapTrade } from "./swap-trade.js";
import { otherVenue, otherVenueId } from "./test-routes.js";

const noRefusal = (): undefined => undefined;

const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const live = new AbortController().signal;
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
const coinPrices = createFakePriceSource(
  new Map([[testCoin, { numerator: 600n, denominator: 10n ** 12n }]]),
);
const passed: PolicyVerdict = ok({ sellsDeniedToken: false });
const refused: PolicyVerdict = { ok: false, error: "per_trade_cap", reasons: ["per_trade_cap"] };
const refuseAgain = async (_quoted: TradeQuote): Promise<PolicyVerdict> => Promise.resolve(refused);

interface Routing {
  readonly venues?: readonly Parameters<typeof createVenueHost>[0]["venues"][number][];
  readonly simulator: Simulator;
  readonly change?: Partial<RouteChoiceOptions>;
  /** A re-quote at a tap, which checks no policy. */
  readonly isRequote?: true;
}

// The fake venue quotes 2 to 1; the other venue quotes at `otherRate` per million.
async function choose(
  otherPerMillion: bigint,
  routing: Routing,
): Promise<ReturnType<typeof chooseRoute>> {
  const clock = createManualClock(testNowMs);
  const venues = routing.venues ?? [
    createFakeVenue(),
    otherVenue({ numerator: otherPerMillion, denominator: 1_000_000n }),
  ];
  const host = createVenueHost({
    venues,
    chains: testChains([otherVenueId]),
    clock,
    callTimeoutMs: 5_000,
  });
  const quotes = await quoteVenues(swap, { host, clock, signal: live });
  const policy = { pricedVenue: "fake-swap", recheck: async () => Promise.resolve(passed) };
  const options: RouteChoiceOptions = {
    swap,
    intent,
    host,
    simulator: routing.simulator,
    prices: coinPrices,
    nativeAsset: testCoin,
    feePerGasBase: 1n,
    signal: live,
    ...(routing.isRequote === true ? {} : { policy }),
    ...routing.change,
  };
  return chooseRoute(quotes, options);
}

function chosenOf(result: Awaited<ReturnType<typeof chooseRoute>>): ChosenRoute {
  if (!result.ok) {
    throw new Error(`Expected a route, got ${result.error}.`);
  }
  return result.value;
}

const venueOf = (route: ChosenRoute): string | undefined =>
  route.planned.built.quote.route[0]?.venue;

describe("the best quote", () => {
  it("picks the route the simulation proves best, not the higher gross quote of a taxed token", async () => {
    // The fake venue quotes 2,000,000 before the token's 0.3% transfer tax; the other quotes
    // 1,996,000 that arrive whole.
    const simulator = createQuoteSimulator(
      noRefusal,
      new Map([["fake-swap", { keptBps: 9_970n, gasUsed: 0n }]]),
    );
    const route = chosenOf(await choose(1_996_000n, { simulator }));
    expect(venueOf(route)).toBe(otherVenueId);
    expect(route.planned.built.quote.expectedOut.base).toBe(1_996_000n);
    expect(route.simulation).toMatchObject({
      ok: true,
      value: { received: [{ base: 1_996_000n }] },
    });
    expect(route.pass).toStrictEqual({ sellsDeniedToken: false });
  });

  it("counts each route's network fee in the asset bought, at the wallet's fee per gas", async () => {
    // At 2 tokens a coin, 300,000 gas costs 600,000 tokens and 100,000 gas costs 200,000.
    const simulator = createQuoteSimulator(
      noRefusal,
      new Map([
        ["fake-swap", { keptBps: 10_000n, gasUsed: 300_000n }],
        [otherVenueId, { keptBps: 10_000n, gasUsed: 100_000n }],
      ]),
    );
    const route = chosenOf(await choose(1_999_900n, { simulator }));
    expect(venueOf(route)).toBe(otherVenueId);
    expect(route.planned.built.quote.gas).toStrictEqual({ asset: testCoin, base: 100_000n });
  });

  it("ranks by what arrives alone when neither side of the trade has a price", async () => {
    const simulator = createQuoteSimulator(
      noRefusal,
      new Map([
        ["fake-swap", { keptBps: 10_000n, gasUsed: 300_000n }],
        [otherVenueId, { keptBps: 10_000n, gasUsed: 100_000n }],
      ]),
    );
    const change = { prices: createFakePriceSource(new Map()) };
    expect(venueOf(chosenOf(await choose(1_999_900n, { simulator, change })))).toBe("fake-swap");
  });

  it("keeps the first venue in the agent's order on a tie", async () => {
    const route = chosenOf(
      await choose(2_000_000n, { simulator: createQuoteSimulator(noRefusal) }),
    );
    expect([venueOf(route), route.pass]).toStrictEqual(["fake-swap", undefined]);
  });

  it("asks the policy again about a route it did not price, and takes the next on a refusal", async () => {
    const change = { policy: { pricedVenue: "fake-swap", recheck: refuseAgain } };
    const route = chosenOf(
      await choose(2_100_000n, { simulator: createQuoteSimulator(noRefusal), change }),
    );
    expect([venueOf(route), route.pass]).toStrictEqual(["fake-swap", undefined]);
  });

  it("checks no policy in a re-quote, and takes the best route", async () => {
    const simulator = createQuoteSimulator(noRefusal);
    const route = chosenOf(await choose(2_100_000n, { simulator, isRequote: true }));
    expect([venueOf(route), route.pass]).toStrictEqual([otherVenueId, undefined]);
  });

  it("keeps the priced venue's failed simulation when no route passes, for the intent to end with", async () => {
    const route = chosenOf(
      await choose(2_100_000n, { simulator: createQuoteSimulator(() => "effects_differ") }),
    );
    expect(venueOf(route)).toBe("fake-swap");
    expect(route.simulation).toStrictEqual(err("effects_differ"));
  });

  it("keeps the priced venue's build failure when it cannot build and no route passes", async () => {
    const broken = { ...createFakeVenue(), build: async () => Promise.reject(new Error("down")) };
    const venues = [broken, otherVenue({ numerator: 2n, denominator: 1n })];
    const simulator = createQuoteSimulator(() => "simulation_reverted");
    await expect(choose(0n, { venues, simulator })).resolves.toStrictEqual(err("venue_down"));
  });

  it("keeps the first venue's refusal when no venue quotes", async () => {
    const quotes: readonly QuoteOutcome[] = [err("no_route"), err("venue_down")];
    const clock = createManualClock(testNowMs);
    const host = createVenueHost({
      venues: [],
      chains: testChains([otherVenueId]),
      clock,
      callTimeoutMs: 5_000,
    });
    const options = {
      swap,
      intent,
      host,
      simulator: createQuoteSimulator(noRefusal),
      prices: coinPrices,
      nativeAsset: testCoin,
      feePerGasBase: 1n,
      signal: live,
    };
    await expect(chooseRoute(quotes, options)).resolves.toStrictEqual(err("no_route"));
    await expect(chooseRoute([], options)).resolves.toStrictEqual(err("venue_down"));
  });
});
