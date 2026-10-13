import { setTimeout as wait } from "node:timers/promises";
import type { AssetRef } from "@binference/chain";
import { type BlockSource, createBlockSource, type WatchedPrice } from "@binference/chain-evm";
import {
  type DayReplay,
  type Fork,
  prepareDayReplay,
  type ReplayedBlock,
} from "@binference/chain-evm/fork";
import { type PricePath, recordedDay, replaySteps } from "@binference/chain-evm/replay";
import { bpsPerWhole, bpsSchema, type Id } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { blockTimeMs, orderPriceOf, wallClock, watcherOn } from "./fork-price-watch.js";
import { confirmedOrder, type FillRig, fillAgent, onFillFork } from "./order-fill-rig.js";

/**
 * The recorded day the replay suite runs: BTCB, ETH and Cake against WBNB on their PancakeSwap v2
 * pairs over 2026-10-12 (UTC), recorded from 48 Club's public node by `pnpm replay:record`.
 */
export const replayDay: PricePath = recordedDay;
/** A pool is replayed once it moved this far from where the replay last put it. */
const replayStepBps = 5;

/** How the watcher learns of each block: polling once a block time, or anvil's `newHeads`. */
export type HeadsBy = "polling" | "subscription";

/** The exit orders on one token, and the levels they were made with. */
export interface ExitOrders {
  readonly pool: number;
  readonly token: AssetRef;
  readonly takeProfit: Id<"ord">;
  readonly stopLoss: Id<"ord">;
  readonly trailing: Id<"ord">;
  /** Micro-dollars a whole token, as the orders saw it before the replay. */
  readonly startUsd: bigint;
  readonly takeProfitUsd: bigint;
  readonly stopLossUsd: bigint;
  readonly trailingBps: number;
  /** The worst price each stop's fill accepts, in micro-dollars a whole token. */
  readonly worstUsd: { readonly stopLoss: bigint; readonly trailing: bigint };
}

/** One fill a watched price started: where it came from and when each step of it happened. */
export interface TimedFill {
  readonly order: Id<"ord">;
  readonly outcome: string;
  /** The block whose price triggered it. */
  readonly block: bigint;
  /** When the block source handed that block on; unknown for a block it never handed on. */
  readonly headAtMs: number | undefined;
  /** When the watcher read its price. */
  readonly readAtMs: number;
  /** When the fill ended, written. */
  readonly endedAtMs: number;
}

/** What one replay of the day with exit orders on the three tokens came to. */
export interface ExitReplay {
  readonly rig: FillRig;
  readonly replay: DayReplay;
  readonly blocks: readonly ReplayedBlock[];
  readonly orders: readonly ExitOrders[];
  /** The fills the replay's prices started, in the order they ended. */
  readonly fills: readonly TimedFill[];
}

const tokenBase = 10n ** 18n;
// A third of what the wallet holds at each exit, so the three exits on a token never empty it.
const exitShare = bpsSchema.parse(3_000);
// Each paper buy spends 0.25 BNB of the paper portfolio's 1 BNB.
const buyBase = 25n * 10n ** 16n;
// A take-profit holds its level at its quote's least out (decision 0197), so it asks little
// slippage, and its level sits under the day's high by the pair's 0.25% fee, that slippage and
// 0.05% more, or no quote of the day would meet it.
const takeProfitSlippageBps = 10;
const quoteMarginBps = 25 + takeProfitSlippageBps + 5;
// A stop's fill accepts down to 3% under its level, as its card shows.
const stopWorstBps = 300n;
// The triggers read the active orders again at most once a second.
const activeOrdersMs = 1_100;
// anvil mines only when the replay asks, so a quiet setup must not end the subscription.
const quietHeadsMs = 300_000;

/** Micro-dollars for one whole token of 18 decimals at a watched price. */
function wholeTokenUsd(price: WatchedPrice): bigint {
  const { numerator, denominator } = orderPriceOf(price).usdPerBaseUnit;
  return (numerator * tokenBase) / denominator;
}

// The block source, handing each head on with when it saw it.
function timedHeads(source: BlockSource, seen: Map<bigint, number>): BlockSource {
  return {
    state: () => source.state(),
    run: async (onHead, signal) =>
      source.run((number, how) => {
        seen.set(number, wallClock.now());
        onHead(number, how);
      }, signal),
  };
}

function blocksBy(fork: Fork, heads: HeadsBy): BlockSource {
  const subscription = {
    url: fork.rpcUrl.replace(/^http:/, "ws:"),
    open: (url: string) => new WebSocket(url),
    headTimeoutMs: quietHeadsMs,
    restMs: quietHeadsMs,
  };
  return createBlockSource({
    rpc: fork.rpc,
    clock: wallClock,
    blockTimeMs,
    ...(heads === "subscription" ? { subscription } : {}),
  });
}

// A pool's recorded prices as the replay's steps move it, as shares of its first.
function scalesOf(replay: DayReplay, pool: number): readonly number[] {
  return replay.steps.flatMap(({ moves }) =>
    moves
      .filter((move) => move.pool === pool)
      .map(({ scale }) => Number((scale.numerator * 1_000_000n) / scale.denominator) / 1_000_000),
  );
}

// The deepest fall from a running high over the path, as a share.
function deepestFall(scales: readonly number[]): number {
  const { deepest } = scales.reduce(
    (seen, scale) => {
      const peak = Math.max(seen.peak, scale);
      return { peak, deepest: Math.max(seen.deepest, 1 - scale / peak) };
    },
    { peak: 1, deepest: 0 },
  );
  return deepest;
}

function shareOf(price: bigint, share: number): bigint {
  return (price * BigInt(Math.round(share * 1_000_000))) / 1_000_000n;
}

function worstUnder(level: bigint): bigint {
  return (level * (BigInt(bpsPerWhole) - stopWorstBps)) / BigInt(bpsPerWhole);
}

/** Where one token's exits sit, from its replayed path and its price before the replay. */
type ExitLevels = Pick<ExitOrders, "takeProfitUsd" | "stopLossUsd" | "trailingBps" | "worstUsd">;

// A take-profit halfway to the day's high less the pair's fee and the slippage, which its own
// quote must meet too (decision 0197); a stop-loss halfway to the day's low; and a trailing stop at
// half its deepest fall from a high: each fires somewhere inside the day.
function levelsOf(replay: DayReplay, exit: { readonly pool: number; readonly startUsd: bigint }) {
  const scales = scalesOf(replay, exit.pool);
  const high = Math.max(1, ...scales);
  const low = Math.min(1, ...scales);
  const sellableHigh = high * (1 - quoteMarginBps / bpsPerWhole);
  const stopLossUsd = shareOf(exit.startUsd, 1 - (1 - low) / 2);
  const trailingBps = Math.max(1, Math.floor((deepestFall(scales) / 2) * bpsPerWhole));
  const levels: ExitLevels = {
    takeProfitUsd: shareOf(exit.startUsd, 1 + Math.max(0, sellableHigh - 1) / 2),
    stopLossUsd,
    trailingBps,
    worstUsd: {
      stopLoss: worstUnder(stopLossUsd),
      trailing: worstUnder(shareOf(exit.startUsd, low * (1 - trailingBps / bpsPerWhole))),
    },
  };
  return levels;
}

function exitRequests(token: AssetRef, levels: ExitLevels): readonly OrderRequest[] {
  const sale = { agent: fillAgent, token, side: "sell", size: { percentBps: exitShare } } as const;
  return [
    {
      ...sale,
      kind: "takeProfit",
      trigger: { price: levels.takeProfitUsd },
      maxSlippageBps: bpsSchema.parse(takeProfitSlippageBps),
      reason: "Half the day's high",
    },
    {
      ...sale,
      kind: "stopLoss",
      trigger: { price: levels.stopLossUsd },
      worstPrice: levels.worstUsd.stopLoss,
      reason: "Half the day's low",
    },
    {
      ...sale,
      kind: "trailing",
      trigger: { distanceBps: bpsSchema.parse(levels.trailingBps) },
      worstPrice: levels.worstUsd.trailing,
      reason: "Half the day's deepest fall",
    },
  ];
}

// The three exits on one token, confirmed on their cards.
async function placeExits(
  rig: FillRig,
  exit: Pick<ExitOrders, "pool" | "token" | "startUsd"> & { readonly replay: DayReplay },
  signal: AbortSignal,
): Promise<ExitOrders> {
  const levels = levelsOf(exit.replay, exit);
  const ids = await Promise.all(
    exitRequests(exit.token, levels).map(async (request) => confirmedOrder(rig, request, signal)),
  );
  const [takeProfit, stopLoss, trailing] = ids;
  if (takeProfit === undefined || stopLoss === undefined || trailing === undefined) {
    throw new Error("Expected three exit orders.");
  }
  const { pool, token, startUsd } = exit;
  return { pool, token, startUsd, takeProfit, stopLoss, trailing, ...levels };
}

/** The watcher's prices and the fills they started, as a replay goes. */
interface Watching {
  readonly last: Map<AssetRef, WatchedPrice>;
  readonly fills: TimedFill[];
  readonly pending: Promise<void>[];
  readonly heads: Map<bigint, number>;
}

// Hands each price the watcher reads to the engine's triggers at once, and keeps each fill it
// started with when its block was seen, its price read and it ended.
function watchAll(
  rig: FillRig,
  fork: Fork,
  run: { readonly heads: HeadsBy; readonly signal: AbortSignal },
) {
  const watching: Watching = { last: new Map(), fills: [], pending: [], heads: new Map() };
  const watcher = watcherOn(fork, timedHeads(blocksBy(fork, run.heads), watching.heads));
  const see = async (price: WatchedPrice): Promise<void> => {
    const headAtMs = watching.heads.get(price.block);
    const outcomes = await rig.engine.seePrice(orderPriceOf(price), { signal: run.signal });
    const endedAtMs = wallClock.now();
    watching.fills.push(
      ...outcomes.map(({ order, outcome }): TimedFill => ({
        order,
        outcome,
        block: price.block,
        readAtMs: price.atMs,
        endedAtMs,
        headAtMs,
      })),
    );
  };
  watcher.onPrice((price) => {
    watching.last.set(price.token, price);
    watching.pending.push(see(price));
  });
  for (const token of rig.tokens) {
    watcher.watch(token);
  }
  return { watching, running: watcher.run(run.signal).catch(() => undefined) };
}

// Mines a block a block time until `count` fills went through.
async function untilFilled(
  fork: Fork,
  watched: { readonly watching: Watching; readonly count: number },
  signal: AbortSignal,
): Promise<void> {
  await fork.call("evm_mine", []);
  await wait(blockTimeMs, undefined, { signal });
  await Promise.all(watched.watching.pending);
  const filled = watched.watching.fills.filter(({ outcome }) => outcome === "filled").length;
  if (filled < watched.count) {
    await untilFilled(fork, watched, signal);
  }
}

/** What a replay of the exits runs on. */
interface ExitRun {
  readonly rig: FillRig;
  readonly fork: Fork;
  readonly heads: HeadsBy;
  readonly signal: AbortSignal;
}

// A paper buy of each token at any price, filled at the next blocks: the position the exits sell.
async function buyEach(run: ExitRun, watching: Watching): Promise<void> {
  const { rig, fork, signal } = run;
  await rig.tokens.reduce<Promise<Id<"ord"> | undefined>>(async (bought, token) => {
    await bought;
    return confirmedOrder(
      rig,
      {
        kind: "limit",
        agent: fillAgent,
        token,
        side: "buy",
        size: { base: buyBase },
        trigger: { price: 1n, direction: "above" },
        worstPrice: 10n ** 15n,
        reason: "Buy the token at any price",
      },
      signal,
    );
  }, Promise.resolve(undefined));
  await untilFilled(fork, { watching, count: rig.tokens.length }, signal);
}

function lastUsd(watching: Watching, token: AssetRef): bigint {
  const price = watching.last.get(token);
  if (price === undefined) {
    throw new Error("The watcher read no price of a bought token.");
  }
  return wholeTokenUsd(price);
}

// Buys, places the exits and replays the day at the chain's pace, then waits for the last fills.
async function runExits(run: ExitRun, replay: DayReplay, watching: Watching): Promise<ExitReplay> {
  const { rig, signal } = run;
  await buyEach(run, watching);
  const orders = await Promise.all(
    rig.tokens.map(async (token, pool) =>
      placeExits(rig, { pool, token, startUsd: lastUsd(watching, token), replay }, signal),
    ),
  );
  await wait(activeOrdersMs, undefined, { signal });
  const before = watching.fills.length;
  const blocks = await replay.run({ paceMs: blockTimeMs, signal });
  await wait(blockTimeMs, undefined, { signal });
  await Promise.all(watching.pending);
  return { rig, replay, blocks, orders, fills: watching.fills.slice(before) };
}

/**
 * Replays the recorded day on the fork with take-profit, stop-loss and trailing orders on each of
 * its three tokens, with no runtime: a paper buy of each token first, then the three exits, which
 * the watcher's prices trigger as the replay moves the pools block by block at the chain's pace.
 */
export async function replayExits(
  signal: AbortSignal,
  heads: HeadsBy,
  test: (replayed: ExitReplay) => Promise<void>,
): Promise<void> {
  const [first, ...rest] = replayDay.pools.map(({ token }) => ({ token, flags: [] }));
  if (first === undefined) {
    throw new Error("The recorded day has no pool.");
  }
  await onFillFork(signal, [first, ...rest], async (rig, fork) => {
    const steps = replaySteps(replayDay, replayStepBps);
    const replay = await prepareDayReplay({
      fork,
      path: replayDay,
      steps,
      clock: wallClock,
      signal,
    });
    const stop = new AbortController();
    const { watching, running } = watchAll(rig, fork, {
      heads,
      signal: AbortSignal.any([signal, stop.signal]),
    });
    try {
      await test(await runExits({ rig, fork, heads, signal }, replay, watching));
    } finally {
      stop.abort();
      await running;
    }
  });
}
