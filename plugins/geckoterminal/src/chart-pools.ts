import type { AssetRef } from "@binference/plugin-sdk";

/** The pool each token's chart was last read from, kept a while to spare the rate limit. */
export interface ChartPools {
  /** The token's chart pool picked within the last `ttlMs`, if any. */
  get(asset: AssetRef, nowMs: number): string | undefined;
  /** Keeps the token's chart pool from `nowMs`, forgetting the oldest kept past `maxEntries`. */
  set(asset: AssetRef, pool: string, nowMs: number): void;
}

/** How long a pick holds and how many are kept. */
export interface ChartPoolsOptions {
  readonly ttlMs: number;
  readonly maxEntries: number;
}

/**
 * Creates the {@link ChartPools} of one source: a bounded memo, so a chart read again soon asks
 * GeckoTerminal for its candles alone, never its pools again.
 */
export function createChartPools(options: ChartPoolsOptions): ChartPools {
  const picks = new Map<AssetRef, { readonly pool: string; readonly atMs: number }>();
  return {
    get(asset, nowMs) {
      const pick = picks.get(asset);
      return pick !== undefined && nowMs - pick.atMs < options.ttlMs ? pick.pool : undefined;
    },
    set(asset, pool, nowMs) {
      picks.delete(asset);
      picks.set(asset, { pool, atMs: nowMs });
      const [oldest] = picks.keys();
      if (picks.size > options.maxEntries && oldest !== undefined) {
        picks.delete(oldest);
      }
    },
  };
}
