import {
  assetRefParts,
  type ChainRef,
  type PriceFeedDefinition,
  type PriceSource,
} from "@binference/chain";
import { createChainlinkPrices, feedAssetsOf } from "@binference/chain-evm";
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

/**
 * The self-hosted price source (decision 0059): for each chain the reads hold, the Chainlink feeds
 * its registry names, read through the chain's one RPC failover. The coin, its one-for-one wrapper
 * and the stablecoins have a feed; every other token takes the trade's own quote in the money path,
 * so here it has no price. A chain with no feeds prices nothing.
 */
export function composePrices(
  reads: ReadonlyMap<ChainRef, ChainReads>,
  options: {
    readonly feeds: ReadonlyMap<ChainRef, readonly PriceFeedDefinition[]>;
    readonly clock: Clock;
  },
): PriceSource {
  const sources = [...reads].map(([chain, { rpc, chain: registered }]): [ChainRef, PriceSource] => [
    chain,
    createChainlinkPrices({
      rpc,
      clock: options.clock,
      assets: feedAssetsOf(registered.definition, options.feeds.get(chain) ?? []),
    }),
  ]);
  return priceRouterOf(new Map(sources));
}
