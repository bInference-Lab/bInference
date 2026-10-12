import type { AssetRef, ReadAnswer } from "@binference/chain";
import { BinferenceError, type Clock, err, type Ratio, type Result } from "@binference/core";
import type { Address } from "viem";
import type { FeedAsset } from "../prices/price-from-round.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import type { BlockSource, BlockSourceState } from "./block-source.js";
import { type QuoteFeedReads, quoteFeedReads } from "./quote-feeds.js";
import { readAggregate } from "./read-aggregate.js";
import { createReadProgress, type ReadProgress } from "./read-progress.js";
import { repeatSteps } from "./repeat-steps.js";
import { createWakeUp, type WakeUp } from "./wake-up.js";
import {
  createWatchList,
  type PlannedToken,
  type PlanPrices,
  type WatchedToken,
  type WatchList,
} from "./watch-list.js";

/** A token's price the watcher read at one block. */
export interface WatchedPrice {
  readonly token: AssetRef;
  /** The block whose state priced it. */
  readonly block: bigint;
  /** When the watcher read it, by its clock. */
  readonly atMs: number;
  /** Who priced it: the venue whose reads it asked, or the pools the chain family reads. */
  readonly source: string;
  readonly quoteAsset: AssetRef;
  /** Base units of the quote asset for one base unit of the token, exact. */
  readonly quotePrice: Ratio;
  /**
   * Micro-dollars for one base unit of the token, exact: the quote price times the quote asset's
   * Chainlink price at the same block. Absent when the quote asset has no usable feed.
   */
  readonly usdPrice?: Ratio;
}

/** How far the watcher's reads trail the chain. */
export interface WatcherLag {
  /** The newest block the block source saw. */
  readonly head?: bigint;
  /** The newest block the watcher read prices at. */
  readonly read?: bigint;
  /**
   * Blocks the reads trail the chain: the head less the block read, plus the blocks the chain
   * should have made since the head while the source saw none.
   */
  readonly lagBlocks: bigint;
  /** Blocks the watcher fell so far behind on that it never read them, since it started. */
  readonly skippedBlocks: bigint;
  /** The block source: how it reads, and its last failure. */
  readonly source: BlockSourceState;
  /** The code of the last batch read that failed, until one succeeds. */
  readonly readFault?: string;
}

/** Reads the prices of the watched tokens of one chain at every block. */
export interface PriceWatcher {
  /**
   * Watches a token. However many watch it, the token is read once a block; the release it
   * answers ends this one watch, and the last release stops the reads.
   */
  watch(token: AssetRef): () => void;
  /** Hands each price read to the listener until the release it answers is called. */
  onPrice(listener: (price: WatchedPrice) => void): () => void;
  /** Every watched token and where it stands. */
  tokens(): readonly WatchedToken[];
  lag(): WatcherLag;
  /** Reads every block until the signal aborts. Rejects with the signal's reason once it aborts. */
  run(signal: AbortSignal): Promise<void>;
}

/** What a price watcher reads with. */
export interface PriceWatcherOptions {
  readonly rpc: RpcFailover;
  readonly blocks: BlockSource;
  readonly clock: Clock;
  /** Multicall3 on the chain, which reads every watched token in one call a block. */
  readonly multicall: Address;
  readonly blockTimeMs: number;
  /** How each token is priced: its reads from the venue host, or the chain family's pools. */
  readonly planPrices: PlanPrices;
  /** The quote assets' Chainlink feeds, which turn a price in a quote asset into USD. */
  readonly feeds: readonly FeedAsset[];
  /**
   * How long one endpoint may take to answer a block's batch before the next is asked; the
   * failover's own timeout when absent.
   */
  readonly callTimeoutMs?: number;
}

// A watcher this far behind reads the newest blocks and leaves the older ones: a price that old no
// longer tells a trigger anything a newer one does not, and a public node may have dropped it.
const maxCatchUpBlocks = 4n;
// A token no reader prices is looked at again after this long.
const replanMs = 30_000;

interface WatcherRun {
  readonly options: PriceWatcherOptions;
  readonly feeds: ReadonlyMap<AssetRef, FeedAsset>;
  readonly list: WatchList;
  readonly progress: ReadProgress;
  readonly emit: (price: WatchedPrice) => void;
  readonly wake: WakeUp;
  readonly signal: AbortSignal;
}

function gcd(left: bigint, right: bigint): bigint {
  return right === 0n ? left : gcd(right, left % right);
}

function times(left: Ratio, right: Ratio): Ratio {
  const numerator = left.numerator * right.numerator;
  const denominator = left.denominator * right.denominator;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function priceOf(planned: PlannedToken, answers: readonly ReadAnswer[]): Result<Ratio, "unpriced"> {
  try {
    return planned.price(answers);
  } catch {
    return err("unpriced");
  }
}

/** One block's batch: the planned tokens, the feeds of their quote assets, and the block. */
interface Batch {
  readonly planned: readonly PlannedToken[];
  readonly feeds: QuoteFeedReads;
  readonly block: bigint;
}

function priceAll(run: WatcherRun, batch: Batch, answers: readonly ReadAnswer[]): void {
  const atMs = run.options.clock.now();
  const tokenCalls = batch.planned.reduce((sum, { calls }) => sum + calls.length, 0);
  const usd = batch.feeds.usdPrices(answers.slice(tokenCalls), atMs);
  let offset = 0;
  for (const planned of batch.planned) {
    const own = answers.slice(offset, offset + planned.calls.length);
    offset += planned.calls.length;
    const price = priceOf(planned, own);
    if (!price.ok) {
      run.list.replan(planned.token);
      continue;
    }
    const quoteUsd = usd.get(planned.quoteAsset);
    const { token, source, quoteAsset } = planned;
    run.emit({
      token,
      block: batch.block,
      atMs,
      source,
      quoteAsset,
      quotePrice: price.value,
      ...(quoteUsd === undefined ? {} : { usdPrice: times(price.value, quoteUsd) }),
    });
  }
}

// One batch for every planned token and the feeds of their quote assets, at one block. A batch no
// endpoint answers is read again a block time later.
async function readBlock(
  run: WatcherRun,
  planned: readonly PlannedToken[],
  block: bigint,
): Promise<boolean> {
  const { rpc, multicall } = run.options;
  const feeds = quoteFeedReads(
    run.feeds,
    planned.map(({ quoteAsset }) => quoteAsset),
  );
  const calls = [...planned.flatMap((token) => token.calls), ...feeds.calls];
  try {
    const timeout =
      run.options.callTimeoutMs === undefined ? {} : { timeoutMs: run.options.callTimeoutMs };
    const answers = await readAggregate(rpc, {
      multicall,
      calls,
      block,
      signal: run.signal,
      ...timeout,
    });
    run.progress.markRead(block);
    priceAll(run, { planned, feeds, block }, answers);
    return true;
  } catch (error) {
    run.signal.throwIfAborted();
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    run.progress.markFailed(error.code);
    return false;
  }
}

async function readStep(run: WatcherRun): Promise<undefined> {
  const { progress, options } = run;
  const head = progress.head();
  const read = progress.read();
  run.list.planDue(run.signal);
  if (head === undefined || (read !== undefined && read >= head)) {
    await run.wake.wait(options.blockTimeMs, run.signal);
    return undefined;
  }
  const planned = run.list.planned();
  if (planned.length === 0) {
    progress.markRead(head);
    return undefined;
  }
  const block = progress.nextBlock(head, maxCatchUpBlocks);
  if (!(await readBlock(run, planned, block))) {
    await options.clock.sleep(options.blockTimeMs, run.signal);
  }
  return undefined;
}

function lagOf(options: PriceWatcherOptions, progress: ReadProgress): WatcherLag {
  const source = options.blocks.state();
  const head = progress.head();
  const read = progress.read();
  const fault = progress.fault();
  const behind = head !== undefined && read !== undefined && head > read ? head - read : 0n;
  const quietMs = source.headAtMs === undefined ? 0 : options.clock.now() - source.headAtMs;
  const silent = BigInt(Math.max(0, Math.floor(quietMs / options.blockTimeMs) - 1));
  return {
    ...(head === undefined ? {} : { head }),
    ...(read === undefined ? {} : { read }),
    lagBlocks: behind + silent,
    skippedBlocks: progress.skipped(),
    source,
    ...(fault === undefined ? {} : { readFault: fault }),
  };
}

/**
 * Creates the price watcher of one chain (ARCHITECTURE.md section 9). Each new block the block
 * source hands on, it reads every watched token's price reads and the Chainlink feeds of their
 * quote assets in one Multicall3 call at that block, so a price change at block N is read at block
 * N, and 200 tokens cost one call a block as one does. A token is read once however many watch it.
 * Behind by more than four blocks, it reads the newest four and counts the rest as skipped. A token
 * whose answers price nothing, such as one that left its curve, is planned again; one no reader
 * prices is asked about again 30 seconds later. A batch that fails is read again a block time
 * later; the watcher never stops for the chain.
 */
export function createPriceWatcher(options: PriceWatcherOptions): PriceWatcher {
  const list = createWatchList({ planPrices: options.planPrices, clock: options.clock, replanMs });
  const listeners = new Set<(price: WatchedPrice) => void>();
  const progress = createReadProgress();
  const emit = (price: WatchedPrice): void => {
    for (const listener of listeners) {
      try {
        listener(price);
      } catch {
        // A listener that fails misses this price; the reads and the other listeners go on.
      }
    }
  };
  return {
    watch: (token) => list.add(token),
    onPrice(listener) {
      const own = (price: WatchedPrice): void => listener(price);
      listeners.add(own);
      return () => listeners.delete(own);
    },
    tokens: () => list.tokens(),
    lag: () => lagOf(options, progress),
    async run(signal) {
      signal.throwIfAborted();
      const wake = createWakeUp(options.clock);
      const feeds = new Map(options.feeds.map((feed) => [feed.asset, feed]));
      const run: WatcherRun = { options, feeds, list, progress, emit, wake, signal };
      const onHead = (number: bigint): void => {
        progress.seeHead(number);
        wake.wake();
      };
      await Promise.all([
        options.blocks.run(onHead, signal),
        repeatSteps(async () => readStep(run)),
      ]);
    },
  };
}
