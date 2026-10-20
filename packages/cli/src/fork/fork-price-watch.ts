import { setTimeout as wait } from "node:timers/promises";
import { assetRefParts } from "@binference/chain";
import {
  createBlockSource,
  createPoolPriceReader,
  createPriceWatcher,
  feedAssetsOf,
  poolSource,
  type BlockSource,
  type PriceWatcher,
  type WatchedPrice,
} from "@binference/chain-evm";
import { bscContract, type Fork } from "@binference/chain-evm/fork";
import { bsc, bscPriceFeeds } from "@binference/chains";
import { type Clock, ok, type Ratio } from "@binference/core";
import type { WatchedOrderPrice } from "@binference/engine/orders";

/**
 * BNB Smart Chain's block time: a fill sent within it of its trigger's read goes out before the
 * block after.
 */
export const blockTimeMs = 450;
// BNB at $600, as the rigs' price sources have it: micro-dollars a base unit of WBNB.
const bnbUsd: Ratio = { numerator: 600n, denominator: 10n ** 12n };

/** The wall clock: the fork mines on it, so the watcher reads on it too. */
export const wallClock: Clock = {
  now: () => Date.now(),
  sleep: async (delayMs, signal) => {
    await wait(delayMs, undefined, { signal });
  },
};

/** A token's price at a block, as the price triggers take it: the pool's WBNB price in USD. */
export function orderPriceOf(price: WatchedPrice): WatchedOrderPrice {
  const { quotePrice } = price;
  return {
    token: price.token,
    usdPerBaseUnit: {
      numerator: quotePrice.numerator * bnbUsd.numerator,
      denominator: quotePrice.denominator * bnbUsd.denominator,
    },
    decimals: 18,
    isThin: false,
    readAtMs: price.atMs,
  };
}

// The block source the watcher reads by when a test names none: `eth_blockNumber` polled once a
// block time.
function pollingBlocks(fork: Fork): BlockSource {
  return createBlockSource({ rpc: fork.rpc, clock: wallClock, blockTimeMs });
}

/**
 * The price watcher on the fork, reading each token from its deepest PancakeSwap v2 pool at each
 * block `blocks` hands on: polled once a block time when absent.
 */
export function watcherOn(fork: Fork, blocks: BlockSource = pollingBlocks(fork)): PriceWatcher {
  const feeds = feedAssetsOf(bsc, bscPriceFeeds);
  const multicall = bscContract("multicall3", "multicall3");
  const clock = wallClock;
  const pools = createPoolPriceReader({
    rpc: fork.rpc,
    chain: fork.chain,
    clock,
    multicall,
    v2Factory: bscContract("pancakeswap", "v2-factory"),
    v3Fees: [],
    quotes: feeds.filter(({ asset }) => assetRefParts(asset).assetNamespace === "erc20"),
    minDepthUsdMicros: 1_000_000_000n,
  });
  return createPriceWatcher({
    rpc: fork.rpc,
    blocks,
    clock,
    multicall,
    blockTimeMs,
    planPrices: async (token, signal) => {
      const read = await pools.priceRead({ token, contracts: {} }, { signal });
      return read.ok ? ok({ source: poolSource, read: read.value }) : read;
    },
    feeds,
  });
}
