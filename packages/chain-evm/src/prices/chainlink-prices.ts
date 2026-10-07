import type { AssetRef, PriceSource } from "@binference/chain";
import { BinferenceError, type Clock, err } from "@binference/core";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { type FeedRound, feedRoundSchema, latestRoundDataCall } from "./feed-round.schema.js";
import { type FeedAsset, priceFromRound, type UsdFeed } from "./price-from-round.js";

/** What {@link createChainlinkPrices} reads the feeds with. */
export interface ChainlinkPricesOptions {
  /** The failover over the RPC endpoints of the chain the feeds are on. */
  readonly rpc: RpcFailover;
  /** The clock a feed's age is measured by. */
  readonly clock: Clock;
  /** The assets the feeds price, each once. Any other asset has no price. */
  readonly assets: readonly FeedAsset[];
}

function byAsset(assets: readonly FeedAsset[]): ReadonlyMap<AssetRef, FeedAsset> {
  const priced = new Map(assets.map((item) => [item.asset, item]));
  if (priced.size !== assets.length) {
    throw new BinferenceError({
      code: "chain.bad_price_feeds",
      message: "Each asset takes its price from one feed.",
      details: { assets: assets.length },
    });
  }
  return priced;
}

// A reverted read, an answer no endpoint gave in the round's shape, and a chain no endpoint
// answers for leave the asset without a price: the trade is refused rather than stalled.
async function readRound(
  rpc: RpcFailover,
  feed: UsdFeed,
  signal: AbortSignal,
): Promise<FeedRound | undefined> {
  try {
    const reply = await rpc.request({
      method: "eth_call",
      params: [{ to: feed.address, data: latestRoundDataCall }, "latest"],
      result: feedRoundSchema,
      signal,
    });
    return reply.kind === "result" ? reply.value : undefined;
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "chain.rpc_down") {
      return undefined;
    }
    throw error;
  }
}

/**
 * The `PriceSource` over Chainlink's USD feeds (decision 0059). Each ask reads the asset's feed
 * through the chain's RPC failover: an asset is worth the feed's answer, and a stablecoin $1 until
 * its feed moves more than 2% away from $1. The price is an exact ratio of micro-dollars per base
 * unit, so only the caller rounds. An asset without a feed, an answer of zero or less, an answer
 * older than its heartbeat plus 30 seconds, a reverted read and a chain no endpoint answers for
 * are all `no_price`, so the policy refuses the trade. Other tokens take their price from the
 * trade's own quote through `withQuotePrice` of `@binference/chain`. Rejects with the signal's
 * reason once the signal aborts.
 */
export function createChainlinkPrices(options: ChainlinkPricesOptions): PriceSource {
  const priced = byAsset(options.assets);
  return {
    async usdPrice(asset, { signal }) {
      signal.throwIfAborted();
      const item = priced.get(asset);
      if (item === undefined) {
        return err("no_price");
      }
      const round = await readRound(options.rpc, item.feed, signal);
      return round === undefined
        ? err("no_price")
        : priceFromRound(item, round, options.clock.now());
    },
  };
}
