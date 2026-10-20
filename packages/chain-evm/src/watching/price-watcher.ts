import type { AssetRef } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { Address } from "viem";
import type { FeedAsset } from "../prices/price-from-round.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import type { BlockSource, BlockSourceState, SeenHead } from "./block-source.js";
import { pricesOf, type ReadQuarantine, type WatchedPrice } from "./price-batch.js";
import { type BlockOutcome, type BlockReader, readBlocks } from "./read-blocks.js";
import { createReadProgress, type ReadProgress } from "./read-progress.js";
import { runWithHeads } from "./run-with-heads.js";
import { createWakeUp, type WakeUp } from "./wake-up.js";
import {
  createWatchList,
  type PlanPrices,
  type WatchedToken,
  type WatchList,
} from "./watch-list.js";

export type { ReadQuarantine, WatchedPrice } from "./price-batch.js";

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
  /**
   * Told of each token whose calls failed a block's whole batch and left it, to be planned again
   * 30 s later (decision 0194).
   */
  readonly onQuarantine?: (quarantine: ReadQuarantine) => void;
}

// A watcher this far behind reads the newest blocks and leaves the older ones: a price that old no
// longer tells a trigger anything a newer one does not, and a public node may have dropped it.
const maxCatchUpBlocks = 4n;
// A token no reader prices is looked at again after this long.
const noReaderMs = 30_000;

interface WatcherRun {
  readonly options: PriceWatcherOptions;
  readonly feeds: ReadonlyMap<AssetRef, FeedAsset>;
  readonly list: WatchList;
  readonly progress: ReadProgress;
  readonly emit: (price: WatchedPrice) => void;
  readonly wake: WakeUp;
  readonly signal: AbortSignal;
}

// A node imports a new block within about a third of a block time of the one that announced it.
const notYetRetryMs = 150;

function blocksFrom(first: bigint, last: bigint): readonly bigint[] {
  const blocks: bigint[] = [];
  for (let block = first; block <= last; block += 1n) {
    blocks.push(block);
  }
  return blocks;
}

// Hands on the prices of each block read, in block order, and answers the outcome that stopped
// the reads, if one did.
function handOn(
  run: WatcherRun,
  read: { readonly outcomes: readonly BlockOutcome[]; readonly askedAtMs: number },
): BlockOutcome | undefined {
  const { outcomes, askedAtMs } = read;
  for (const outcome of outcomes) {
    if (outcome.kind === "failed") {
      run.progress.markFailed(outcome.code);
    }
    if (outcome.kind !== "read") {
      return outcome;
    }
    run.progress.markRead(outcome.read.block);
    outcome.read.quarantined.forEach((quarantine) => run.options.onQuarantine?.(quarantine));
    const times = { atMs: run.options.clock.now(), askedAtMs };
    for (const { token, outcome: tokenRead, price } of pricesOf(outcome.read, times)) {
      run.list.report(token, tokenRead);
      if (price !== undefined) {
        run.emit(price);
      }
    }
  }
  return undefined;
}

function readerOf(run: WatcherRun): BlockReader {
  const { rpc, multicall, callTimeoutMs } = run.options;
  const preferEndpoint = run.progress.headEndpoint();
  return {
    rpc,
    multicall,
    feeds: run.feeds,
    signal: run.signal,
    ...(callTimeoutMs === undefined ? {} : { timeoutMs: callTimeoutMs }),
    ...(preferEndpoint === undefined ? {} : { preferEndpoint }),
  };
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
  const blocks = blocksFrom(progress.nextBlock(head, maxCatchUpBlocks), head);
  const askedAtMs = options.clock.now();
  const outcomes = await readBlocks(readerOf(run), planned, blocks);
  const stopped = handOn(run, { outcomes, askedAtMs });
  if (stopped !== undefined) {
    const waitMs = stopped.kind === "not_yet" ? notYetRetryMs : options.blockTimeMs;
    await options.clock.sleep(waitMs, run.signal);
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

/** What one run of a watcher reads with, besides its signal. */
type RunParts = Pick<WatcherRun, "options" | "list" | "progress" | "emit">;

// The block source and the reads end together: a fault in either stops both.
async function runWatcher(parts: RunParts, signal: AbortSignal): Promise<void> {
  const { options, progress } = parts;
  const feeds = new Map(options.feeds.map((feed) => [feed.asset, feed]));
  await runWithHeads(
    options.blocks,
    (shared) => {
      const wake = createWakeUp(options.clock);
      const run: WatcherRun = { ...parts, feeds, wake, signal: shared };
      const onHead = (number: bigint, seen?: SeenHead): void => {
        progress.seeHead(number, seen?.endpoint);
        if (seen?.isReorg === true) {
          progress.rewind(number);
        }
        wake.wake();
      };
      return { onHead, step: async () => readStep(run) };
    },
    signal,
  );
}

/**
 * Creates the price watcher of one chain (ARCHITECTURE.md section 9). Each new block the block
 * source hands on, it reads every watched token's price reads and the Chainlink feeds of their
 * quote assets in one Multicall3 call at that block, so a price change at block N is read at block
 * N, and 200 tokens cost one call a block as one does. A token is read once however many watch it.
 * Behind, it reads the blocks up to the head at once, each its own call sent together, and hands
 * their prices on in block order; behind by more than four, it reads the newest four and counts
 * the rest as skipped. A token's plan is kept through two blocks whose answers price nothing and
 * replaced after the third, or at once when its answers say it no longer holds, such as a token
 * that left its curve or a pool gone thin; its pools are found again every 10 minutes while it
 * prices. A token no reader prices is asked about again 30 seconds later. A batch that fails is
 * read again a block time later; the watcher never stops for the chain. A fault of its own ends the block source and the
 * reads together, and `run` rejects with it.
 */
export function createPriceWatcher(options: PriceWatcherOptions): PriceWatcher {
  const list = createWatchList({
    planPrices: options.planPrices,
    clock: options.clock,
    noReaderMs,
    retryMs: options.blockTimeMs,
  });
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
    run: async (signal) => runWatcher({ options, list, progress, emit }, signal),
  };
}
