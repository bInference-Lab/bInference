import type { ChainRegistry, TxSimulator, Venue } from "@binference/chain";
import { createFakeTxSimulator } from "@binference/chain/testing";
import type { ManualClock } from "@binference/core/testing";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeRiskCheck } from "../fakes/fake-risk-check.js";
import { createFakeTokenFacts } from "../fakes/fake-token-facts.js";
import { createQuoteSimulator } from "../fakes/quote-simulator.js";
import { testCoin } from "../intents/test-intents.js";
import { createSourceMarketReads } from "../market/source-market-reads.js";
import type { RiskCheck, Simulator } from "../ports.js";
import { createLaunchHost } from "../venues/launch-host.js";
import { createVenueHost } from "../venues/venue-host.js";
import type { EngineOptions } from "./create-engine.js";
import type { TestEngineOptions } from "./test-engine.js";

/** The steps a test may replace: the risk check and the simulators, fakes when it gives none. */
export function stepsOf(
  options: TestEngineOptions,
  fakes: { readonly chains: ChainRegistry; readonly clock: ManualClock },
): {
  readonly risk: RiskCheck;
  readonly simulator: Simulator;
  readonly chainSimulator: TxSimulator;
} {
  return {
    risk: options.risk ?? createFakeRiskCheck(fakes),
    simulator: options.simulator ?? createQuoteSimulator(() => options.refusal),
    chainSimulator: options.chainSimulator ?? createFakeTxSimulator(new Map()),
  };
}

/**
 * The venue host and its launch side over the test's venues, the tokens that hold code, and the
 * owner's uploads it gives.
 */
export function hostsOf(
  options: TestEngineOptions,
  parts: {
    readonly venues: readonly Venue[];
    readonly chains: ChainRegistry;
    readonly clock: ManualClock;
  },
): Pick<EngineOptions, "host" | "launchHost" | "launchTokenCode" | "launchImages"> {
  const hosted = { ...parts, callTimeoutMs: 5_000 };
  const { launchImages } = options;
  const withCode = new Set(options.tokensWithCode);
  return {
    host: createVenueHost(hosted),
    launchHost: createLaunchHost({
      ...hosted,
      ...(options.unboundFirstBuys === undefined
        ? {}
        : { unboundFirstBuys: options.unboundFirstBuys }),
    }),
    launchTokenCode: async (token, { signal }) => {
      signal.throwIfAborted();
      return Promise.resolve(withCode.has(token));
    },
    ...(launchImages === undefined ? {} : { launchImages }),
  };
}

/**
 * What the engine reads of prices and markets: the coin at $600 and no market data, unless the
 * test gives its own, a watcher that prices every token but those the test names, and the facts
 * of every unlisted token.
 */
export function readsOf(
  options: TestEngineOptions,
  clock: ManualClock,
): Pick<EngineOptions, "prices" | "marketReads" | "canPrice" | "readTokenFacts"> {
  const prices =
    options.prices ?? new Map([[testCoin, { numerator: 600n, denominator: 10n ** 12n }]]);
  const source = createFakePriceSource(prices);
  return {
    prices: options.priceSource?.(source) ?? source,
    marketReads:
      options.marketReads ?? createSourceMarketReads({ sources: [], clock, timeoutMs: 5_000 }),
    canPrice: async (token) => await Promise.resolve(!(options.unpriceable ?? []).includes(token)),
    readTokenFacts: options.tokenFacts ?? createFakeTokenFacts().read,
  };
}
