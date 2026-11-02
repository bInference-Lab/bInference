import {
  assetRefParts,
  type ChainRef,
  type PriceFeedDefinition,
  type PriceSource,
  type RatePriceDefinition,
} from "@binference/chain";
import {
  createChainlinkPrices,
  createRatePrices,
  feedAssetsOf,
  rateAssetsOf,
} from "@binference/chain-evm";
import { type Clock, err } from "@binference/core";
import type { ChainReads } from "./chain-reads.js";

/** A price source that asks each asset's own chain's source; another chain's asset has no price. */
export function priceRouterOf(sources: ReadonlyMap<ChainRef, PriceSource>): PriceSource {
  return {
    async usdPrice(asset, options) {
      options.signal.throwIfAborted();
      const source = sources.get(assetRefParts(asset).chain);
      return source === undefined ? err("no_price") : source.usdPrice(asset, options);
    },
  };
}

// A rate read has 5 s in all: the head block, then the pause and the rate at it.
const rateReadTimeoutMs = 5_000;

/**
 * The self-hosted price source (decision 0059): for each chain the reads hold, the Chainlink feeds
 * its registry names, read through the chain's one RPC failover. The coin, its one-for-one wrapper
 * and the stablecoins have a feed; a token the registry prices by a rate, such as a liquid staking
 * token, is worth the coin's price times its contract's rate (decision 0328); every other token
 * takes the trade's own quote in the money path, so here it has no price. A chain with no feeds
 * prices nothing.
 */
export function composePrices(
  reads: ReadonlyMap<ChainRef, ChainReads>,
  options: {
    readonly feeds: ReadonlyMap<ChainRef, readonly PriceFeedDefinition[]>;
    readonly rates: ReadonlyMap<ChainRef, readonly RatePriceDefinition[]>;
    readonly clock: Clock;
  },
): PriceSource {
  const { clock } = options;
  const sources = [...reads].map(([chain, read]): [ChainRef, PriceSource] => {
    const { rpc, multicall, chain: registered } = read;
    const { definition } = registered;
    const feeds = createChainlinkPrices({
      rpc,
      clock,
      assets: feedAssetsOf(definition, options.feeds.get(chain) ?? []),
    });
    const source = createRatePrices({
      rpc,
      multicall,
      clock,
      timeoutMs: rateReadTimeoutMs,
      prices: feeds,
      assets: rateAssetsOf(definition, options.rates.get(chain) ?? []),
    });
    return [chain, source];
  });
  return priceRouterOf(new Map(sources));
}
