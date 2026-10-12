import { BinferenceError, err, ok } from "@binference/core";
import { type AssetRef, assetRefParts } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { MarketPool, TrendingToken } from "../market/market-pool.js";
import type { MarketDataSource } from "../market/ports.js";

/** A fake market data source's answers, and whether its service is down. */
export interface FakeMarketSourceOptions {
  readonly id: string;
  /** The chains it serves; any other chain is `not_covered`. */
  readonly chains: readonly ChainRef[];
  /** Each token's pools, deepest first; a token it lacks has none. */
  readonly pools?: ReadonlyMap<AssetRef, readonly MarketPool[]>;
  /** Each chain's trending tokens, in order; a chain it lacks has none. */
  readonly trending?: ReadonlyMap<ChainRef, readonly TrendingToken[]>;
  /** Every read rejects with `<id>.unavailable`, as a service that is down. */
  readonly isDown?: boolean;
}

/** A fake market data source that counts the reads it answered. */
export interface FakeMarketSource extends MarketDataSource {
  /** How many reads reached the source, the refused ones too. */
  reads(): number;
}

/**
 * Creates a market data source for tests: it answers each token and chain from its tables, and
 * every read of a source that is down rejects as a service that does not answer.
 */
export function createFakeMarketSource(options: FakeMarketSourceOptions): FakeMarketSource {
  let count = 0;
  const served = new Set(options.chains);
  const reached = (signal: AbortSignal): void => {
    signal.throwIfAborted();
    count += 1;
    if (options.isDown === true) {
      throw new BinferenceError({
        code: `${options.id}.unavailable`,
        message: `The fake market source ${options.id} is down.`,
        retryable: true,
      });
    }
  };
  return {
    id: options.id,
    async pools(asset, { signal }) {
      reached(signal);
      const isServed = served.has(assetRefParts(asset).chain);
      return await Promise.resolve(
        isServed ? ok(options.pools?.get(asset) ?? []) : err("not_covered"),
      );
    },
    async trending(chain, { signal }) {
      reached(signal);
      return await Promise.resolve(
        served.has(chain) ? ok(options.trending?.get(chain) ?? []) : err("not_covered"),
      );
    },
    reads: () => count,
  };
}
