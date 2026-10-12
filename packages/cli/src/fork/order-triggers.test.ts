import { setTimeout as wait } from "node:timers/promises";
import { assetRefParts } from "@binference/chain";
import {
  createBlockSource,
  createPoolPriceReader,
  createPriceWatcher,
  feedAssetsOf,
  poolSource,
  type PriceWatcher,
  type WatchedPrice,
} from "@binference/chain-evm";
import { bscContract, type Fork } from "@binference/chain-evm/fork";
import { bsc, bscPriceFeeds } from "@binference/chains";
import { bpsSchema, type Clock, ok, type Ratio } from "@binference/core";
import type { WatchedOrderPrice } from "@binference/engine/orders";
import { describe, expect, it } from "vitest";
import { confirmedOrder, type FillRig, fillAgent, onFillFork, xvs } from "./order-fill-rig.js";

// BNB Smart Chain's block time: a fill sent within it of its trigger's read goes out before the
// block after.
const blockTimeMs = 450;
// BNB at $600, as the rig's price source has it: micro-dollars a base unit of WBNB.
const bnbUsd: Ratio = { numerator: 600n, denominator: 10n ** 12n };

// The fork mines on the wall clock, so the watcher reads on it too.
const clock: Clock = {
  now: () => Date.now(),
  sleep: async (delayMs, signal) => {
    await wait(delayMs, undefined, { signal });
  },
};

// The token's price at a block, as the price triggers take it: the pool's WBNB price in USD.
function orderPriceOf(price: WatchedPrice): WatchedOrderPrice {
  const { quotePrice } = price;
  return {
    token: price.token,
    usdPerBaseUnit: {
      numerator: quotePrice.numerator * bnbUsd.numerator,
      denominator: quotePrice.denominator * bnbUsd.denominator,
    },
    decimals: 18,
    isThin: false,
  };
}

/** A fill that a price at a block triggered: when the price was read, and when the fill ended. */
interface Timed {
  readonly block: bigint;
  readonly readAtMs: number;
  readonly endedAtMs: number;
  readonly outcomes: readonly string[];
}

// The watcher on the fork, reading XVS from its deepest PancakeSwap pool against WBNB.
function watcherOn(fork: Fork): PriceWatcher {
  const feeds = feedAssetsOf(bsc, bscPriceFeeds);
  const multicall = bscContract("multicall3", "multicall3");
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
    blocks: createBlockSource({ rpc: fork.rpc, clock, blockTimeMs }),
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

// Hands each read price to the engine's triggers at once, in the block's own processing, and
// keeps when each price was read and when the fills it started ended.
function handOn(rig: FillRig, watcher: PriceWatcher, signal: AbortSignal): Timed[] {
  const timed: Timed[] = [];
  const see = async (price: WatchedPrice): Promise<void> => {
    const outcomes = await rig.engine.seePrice(orderPriceOf(price), { signal });
    const ended = { block: price.block, readAtMs: price.atMs, endedAtMs: Date.now() };
    timed.push({ ...ended, outcomes: outcomes.map(({ outcome }) => outcome) });
  };
  watcher.onPrice((price) => {
    void see(price);
  });
  return timed;
}

// Mines a block a block time, until a price read after the first `from` prices led to a fill.
async function fillAtNextBlock(
  fork: Fork,
  watched: { readonly timed: readonly Timed[]; readonly from: number },
  signal: AbortSignal,
): Promise<Timed> {
  await fork.call("evm_mine", []);
  await wait(blockTimeMs, undefined, { signal });
  const found = watched.timed
    .slice(watched.from)
    .find(({ outcomes }) => outcomes.includes("filled"));
  return found ?? fillAtNextBlock(fork, watched, signal);
}

// A limit buy of 0.02 BNB of the rig's token, which any price triggers.
async function anyPriceBuy(rig: FillRig, signal: AbortSignal): Promise<void> {
  await confirmedOrder(
    rig,
    {
      kind: "limit",
      agent: fillAgent,
      token: rig.token,
      side: "buy",
      size: { base: 2n * 10n ** 16n },
      trigger: { price: 1n, direction: "above" },
      reason: "Buy the token at any price",
    },
    signal,
  );
}

// A take-profit that sells all of the rig's token at any price above a micro-dollar.
async function anyPriceTakeProfit(rig: FillRig, signal: AbortSignal): Promise<void> {
  await confirmedOrder(
    rig,
    {
      kind: "takeProfit",
      agent: fillAgent,
      token: rig.token,
      side: "sell",
      size: { percentBps: bpsSchema.parse(10_000) },
      trigger: { price: 1n },
      reason: "Take the profit at any price",
    },
    signal,
  );
}

describe("price triggers on a BSC fork", () => {
  it("fills a paper take-profit within a block of the price that triggered it", async ({
    signal,
  }) =>
    onFillFork(signal, { token: xvs, flags: [] }, async (rig, fork) => {
      const watcher = watcherOn(fork);
      const stop = new AbortController();
      const timed = handOn(rig, watcher, stop.signal);
      watcher.watch(rig.token);
      const running = watcher.run(stop.signal).catch(() => undefined);
      try {
        // A buy fills the paper position and reads the fork's state of the pair, the router and
        // the token, as a running engine has it; the take-profit that sells it is timed.
        await anyPriceBuy(rig, signal);
        await fillAtNextBlock(fork, { timed, from: 0 }, signal);
        const bought = timed.length;
        await anyPriceTakeProfit(rig, signal);
        const measured = await fillAtNextBlock(fork, { timed, from: bought }, signal);

        expect(measured.endedAtMs - measured.readAtMs).toBeLessThan(blockTimeMs);
        const query = { states: ["paper_filled" as const], limit: 5 };
        const filled = await rig.stores.intents.list(query, { signal });
        expect(filled.map(({ kind }) => kind)).toStrictEqual(["buy", "sell"]);
      } finally {
        stop.abort();
        await running;
      }
    }));
});
