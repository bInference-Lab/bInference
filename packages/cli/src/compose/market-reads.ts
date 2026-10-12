import type { Clock, Http } from "@binference/core";
import { createDexscreenerSource } from "@binference/dexscreener";
import { createSourceMarketReads, type MarketReads } from "@binference/engine/market";
import { createGeckoterminalSource } from "@binference/geckoterminal";

// A market read the owner or the agent waits on gives up past this, a wait for a source's rate
// limit included; each source waits at most 10 seconds for its turn.
const readTimeoutMs = 15_000;
const maxWaitMs = 10_000;

/**
 * The market reads of a self-hosted engine over the engine's outbound HTTP, each source paced
 * under its published limits for this machine alone: pools and trending tokens from DEX
 * Screener's keyless public API, candles from GeckoTerminal's (decision 0184).
 */
export function selfHostedMarketReads(options: {
  readonly http: Http;
  readonly clock: Clock;
}): MarketReads {
  const dexscreener = createDexscreenerSource({ ...options, maxWaitMs });
  const geckoterminal = createGeckoterminalSource({ ...options, maxWaitMs });
  return createSourceMarketReads({
    sources: [dexscreener],
    chartSources: [geckoterminal],
    clock: options.clock,
    timeoutMs: readTimeoutMs,
  });
}
