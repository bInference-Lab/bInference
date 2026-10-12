import { setTimeout as wait } from "node:timers/promises";
import {
  accountRefSchema,
  accountRefParts,
  assetRefSchema,
  type PriceRead,
} from "@binference/chain";
import { bsc, bscPriceFeeds } from "@binference/chains";
import { type Clock, ok, type Result } from "@binference/core";
import { type Address, encodeFunctionData, getAddress, type Hex, parseAbi, parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { feedAssetsOf } from "../prices/feed-assets.js";
import { quantitySchema } from "../rpc/evm-wire.schema.js";
import { createBlockSource } from "../watching/block-source.js";
import { createPoolPriceReader } from "../watching/pool-price-reader.js";
import { isToken0, poolPrice, reservesCall } from "../watching/pool-state.js";
import {
  createPriceWatcher,
  type PriceWatcher,
  type WatchedPrice,
} from "../watching/price-watcher.js";
import type { PlanPrices } from "../watching/watch-list.js";
import { bscContract, bscToken } from "./bsc-addresses.js";
import type { Fork } from "./open-fork.js";
import { withFork } from "./with-fork.js";

const blockTimeMs = 450;
const multicall = bscContract("multicall3", "multicall3");
const router = bscContract("pancakeswap", "v2-router");
const cake = bscToken("Cake");
const wbnb = bscToken("WBNB");
const cakeAsset = assetRefSchema.parse(`eip155:56/erc20:${cake}`);
// Blocks mined one block time apart while the watcher reads, to measure its lag.
const measuredBlocks = 24;

const abi = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

// The fork mines on the wall clock, so the watcher reads on it too: an abort ends a sleep with the
// signal's reason, as the clock port says.
const clock: Clock = {
  now: () => Date.now(),
  sleep: async (delayMs, signal) => {
    try {
      await wait(delayMs, undefined, { signal });
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    }
  },
};

async function cakePair(fork: Fork): Promise<Address> {
  return fork.client.readContract({
    address: bscContract("pancakeswap", "v2-factory"),
    abi,
    functionName: "getPair",
    args: [cake, wbnb],
  });
}

// CAKE priced by its v2 pair with WBNB, read through the batch as a venue's read would be.
function pairPlan(pair: Address): PlanPrices {
  const place = { kind: "v2" as const, isToken0: isToken0(cake, wbnb) };
  return async () =>
    await Promise.resolve(
      ok({
        source: "pancakeswap-v2",
        read: {
          quoteAsset: assetRefSchema.parse(`eip155:56/erc20:${wbnb}`),
          calls: [{ target: accountRefSchema.parse(`eip155:56:${pair}`), input: reservesCall }],
          price: (answers: readonly (string | undefined)[]) => poolPrice(place, answers),
        },
      }),
    );
}

interface Watching {
  readonly watcher: PriceWatcher;
  readonly prices: WatchedPrice[];
  /** Resolves with the first price read at the block. */
  readonly at: (block: bigint, signal: AbortSignal) => Promise<WatchedPrice>;
  readonly stop: AbortController;
}

function watchOn(fork: Fork, planPrices: PlanPrices): Watching {
  const blocks = createBlockSource({ rpc: fork.rpc, clock, blockTimeMs });
  const feeds = feedAssetsOf(bsc, bscPriceFeeds);
  const watcher = createPriceWatcher({
    rpc: fork.rpc,
    blocks,
    clock,
    multicall,
    blockTimeMs,
    planPrices,
    feeds,
  });
  const prices: WatchedPrice[] = [];
  const waiting = new Map<bigint, (price: WatchedPrice) => void>();
  watcher.onPrice((price) => {
    prices.push(price);
    waiting.get(price.block)?.(price);
  });
  const stop = new AbortController();
  watcher.run(stop.signal).catch(() => undefined);
  const at = async (block: bigint, signal: AbortSignal) => {
    const seen = prices.find((price) => price.block === block);
    return (
      seen ??
      (await new Promise<WatchedPrice>((resolve, reject) => {
        waiting.set(block, resolve);
        signal.addEventListener("abort", () => reject(signal.reason));
      }))
    );
  };
  return { watcher, prices, at, stop };
}

async function headOf(fork: Fork): Promise<bigint> {
  return quantitySchema.parse(await fork.call("eth_blockNumber", []));
}

async function mine(fork: Fork): Promise<bigint> {
  await fork.call("evm_mine", []);
  return headOf(fork);
}

// The read a reader answered; a test that expects one fails on a refusal.
function readOf(result: Result<PriceRead, "no_price_read">): PriceRead {
  if (!result.ok) {
    throw new Error("The pools priced nothing.");
  }
  return result.value;
}

const sleep = async (delayMs: number) => clock.sleep(delayMs, new AbortController().signal);

// Mines `count` blocks one block time apart, and says when each was mined.
async function mineEvery(fork: Fork, count: number, mined: Map<bigint, number>): Promise<void> {
  if (count === 0) {
    return;
  }
  const startedMs = Date.now();
  mined.set(await mine(fork), Date.now());
  await sleep(Math.max(0, startedMs + blockTimeMs - Date.now()));
  await mineEvery(fork, count - 1, mined);
}

// The pair's CAKE and WBNB reserves at a block.
async function reservesAt(fork: Fork, pair: Address, block: bigint) {
  const [reserve0, reserve1] = await fork.client.readContract({
    address: pair,
    abi,
    functionName: "getReserves",
    blockNumber: block,
  });
  return isToken0(cake, wbnb)
    ? { cakeReserve: reserve0, wbnbReserve: reserve1 }
    : { cakeReserve: reserve1, wbnbReserve: reserve0 };
}

// The newest block mined.
function lastOf(mined: ReadonlyMap<bigint, number>): bigint {
  return [...mined.keys()].at(-1) ?? 0n;
}

// How long after each mined block the watcher read its price, in milliseconds.
function delaysOf(
  mined: ReadonlyMap<bigint, number>,
  prices: readonly WatchedPrice[],
): readonly number[] {
  return [...mined].map(([block, minedAtMs]) => {
    const readAtMs = prices.find((price) => price.block === block)?.atMs ?? Infinity;
    return readAtMs - minedAtMs;
  });
}

const meanOf = (values: readonly number[]): number =>
  Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

// The lags in blocks and the delays in milliseconds, worst and mean, for the report.
function summaryOf(lags: readonly number[], delays: readonly number[], skipped: bigint): string {
  const hundredths = Math.round((lags.reduce((sum, lag) => sum + lag, 0) * 100) / lags.length);
  return (
    `lag in blocks over ${String(lags.length)} blocks: max ${String(Math.max(...lags))}, ` +
    `mean ${String(hundredths)}/100, each [${lags.join(",")}]; skipped ${String(skipped)}; ` +
    `read after mining: max ${String(Math.max(...delays))} ms, mean ${String(meanOf(delays))} ms`
  );
}

// The one call a plan reads, as an eth_call takes it.
function callOf(plan: PriceRead): { readonly to: Address; readonly data: Hex } {
  const [call] = plan.calls;
  if (call === undefined || plan.calls.length !== 1) {
    throw new Error("The plan reads another number of calls than one.");
  }
  return { to: getAddress(accountRefParts(call.target).address), data: call.input as Hex };
}

// For each mined block, how many later blocks were mined before the watcher read it.
function lagsOf(
  mined: ReadonlyMap<bigint, number>,
  prices: readonly WatchedPrice[],
): readonly number[] {
  return [...mined].map(([block]) => {
    const readAtMs = prices.find((price) => price.block === block)?.atMs ?? Infinity;
    return [...mined].filter(([later, atMs]) => later > block && atMs <= readAtMs).length;
  });
}

describe("the price watcher on a BSC fork", () => {
  it("reads a pool's price change at the block that made it", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const pair = await cakePair(fork);
      const watching = watchOn(fork, pairPlan(pair));
      try {
        watching.watcher.watch(cakeAsset);
        await sleep(blockTimeMs);
        const before = await watching.at(await mine(fork), signal);
        const { timestamp } = await fork.client.getBlock();
        const receipt = await fork.send({
          from: fork.account,
          to: router,
          value: parseEther("5"),
          data: encodeFunctionData({
            abi,
            functionName: "swapExactETHForTokens",
            args: [0n, [wbnb, cake], fork.account, timestamp + 300n],
          }),
        });
        expect(receipt.status).toBe("success");
        const after = await watching.at(receipt.blockNumber, signal);
        const { cakeReserve, wbnbReserve } = await reservesAt(fork, pair, receipt.blockNumber);
        expect(after.quotePrice.numerator * cakeReserve).toBe(
          after.quotePrice.denominator * wbnbReserve,
        );
        expect(after.quotePrice.numerator * before.quotePrice.denominator).toBeGreaterThan(
          before.quotePrice.numerator * after.quotePrice.denominator,
        );
        expect(after.usdPrice).toBeDefined();
      } finally {
        watching.stop.abort();
      }
    }));

  it("reads each block a block time apart within a block of the head", async ({
    signal,
    annotate,
  }) =>
    withFork(signal, async (fork) => {
      const watching = watchOn(fork, pairPlan(await cakePair(fork)));
      try {
        watching.watcher.watch(cakeAsset);
        await sleep(blockTimeMs);
        await watching.at(await mine(fork), signal);
        const mined = new Map<bigint, number>();
        await mineEvery(fork, measuredBlocks, mined);
        await watching.at(lastOf(mined), signal);
        const lags = lagsOf(mined, watching.prices);
        const delays = delaysOf(mined, watching.prices);
        await annotate(summaryOf(lags, delays, watching.watcher.lag().skippedBlocks));
        expect(lags).toHaveLength(measuredBlocks);
        expect(Math.max(...lags)).toBeLessThanOrEqual(1);
        expect(watching.watcher.lag().skippedBlocks).toBe(0n);
      } finally {
        watching.stop.abort();
      }
    }));

  it("finds a token's deepest pool on chain and prices it from one read", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const reader = createPoolPriceReader({
        rpc: fork.rpc,
        chain: fork.chain,
        clock,
        multicall,
        v2Factory: bscContract("pancakeswap", "v2-factory"),
        v3Factory: bscContract("pancakeswap", "v3-factory"),
        v3Fees: [100, 500, 2_500, 10_000],
        quotes: feedAssetsOf(bsc, bscPriceFeeds).filter(({ asset }) => asset.includes("/erc20:")),
        minDepthUsdMicros: 1_000_000_000n,
      });
      const plan = readOf(await reader.priceRead({ token: cakeAsset, contracts: {} }, { signal }));
      const answer = await fork.client.call(callOf(plan));
      expect(plan.price([answer.data])).toMatchObject({ ok: true });
    }));
});
