import type { MarketDataSource } from "@binference/chain";
import type { Clock, Http } from "@binference/core";
import { createDexscreenerSource } from "@binference/dexscreener";
import { createSourceMarketReads, type MarketReads } from "@binference/engine/market";
import { createGeckoterminalSource } from "@binference/geckoterminal";

// A market read the owner or the agent waits on gives up past this, a wait for a source's rate
// limit included; each source waits at most 10 seconds for its turn.
const readTimeoutMs = 15_000;
const maxWaitMs = 10_000;

/**
 * The market data sources of a self-hosted engine, one of each. Every reader shares them, the
 * market reads and the price watchers' cross-check alike, so each source paces every request of
 * this machine under its published limit: GeckoTerminal's about 10 calls a minute in all.
 */
export interface SelfHostedSources {
  readonly dexscreener: MarketDataSource;
  readonly geckoterminal: MarketDataSource;
}

/** Makes the self-hosted engine's one DEX Screener source and one GeckoTerminal source. */
export function selfHostedSources(options: {
  readonly http: Http;
  readonly clock: Clock;
}): SelfHostedSources {
  return {
    dexscreener: createDexscreenerSource({ ...options, maxWaitMs }),
    geckoterminal: createGeckoterminalSource({ ...options, maxWaitMs }),
  };
}

/**
 * The market reads of a self-hosted engine over its shared sources: pools and trending tokens from
 * DEX Screener's keyless public API, candles from GeckoTerminal's (decision 0184).
 */
export function selfHostedMarketReads(sources: SelfHostedSources, clock: Clock): MarketReads {
  return createSourceMarketReads({
    sources: [sources.dexscreener],
    chartSources: [sources.geckoterminal],
    clock,
    timeoutMs: readTimeoutMs,
  });
}
