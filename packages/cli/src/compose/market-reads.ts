import type { Clock, Http } from "@binference/core";
import { createDexscreenerSource } from "@binference/dexscreener";
import { createSourceMarketReads, type MarketReads } from "@binference/engine/market";

// A market read the owner or the agent waits on gives up past this, a wait for DEX Screener's
// rate limit included; the source waits at most 10 seconds for its turn.
const readTimeoutMs = 15_000;
const maxWaitMs = 10_000;

/**
 * The market reads of a self-hosted engine: DEX Screener's keyless public API over the engine's
 * outbound HTTP, paced under its published limits for this machine alone.
 */
export function selfHostedMarketReads(options: {
  readonly http: Http;
  readonly clock: Clock;
}): MarketReads {
  const dexscreener = createDexscreenerSource({ ...options, maxWaitMs });
  return createSourceMarketReads({
    sources: [dexscreener],
    clock: options.clock,
    timeoutMs: readTimeoutMs,
  });
}
