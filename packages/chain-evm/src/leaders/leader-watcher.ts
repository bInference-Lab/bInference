import type { AccountRef, AssetRef } from "@binference/chain";
import { BinferenceError, type Clock } from "@binference/core";
import { type Address, type Hex, toHex } from "viem";
import type { FeedAsset } from "../prices/price-from-round.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import type { BlockSource } from "../watching/block-source.js";
import { runWithHeads } from "../watching/run-with-heads.js";
import { createWakeUp, type WakeUp } from "../watching/wake-up.js";
import { type BlockHeader, blockHeaderSchema } from "./chain-block.schema.js";
import type { LeaderReader } from "./leader-reader.js";
import type { TradeContext } from "./match-trades.js";
import { type LeaderRead, readLeaderSpan, type SpanWallet } from "./read-leader-span.js";

/** A tracked wallet as the store keeps it: the first and the last block read of it. */
export interface TrackedLeader {
  readonly account: AccountRef;
  readonly sinceBlock?: bigint;
  readonly lastBlock?: bigint;
}

/** Where the watcher stopped: its last block read, and that block's hash. */
export interface WatchCursor {
  readonly block: bigint;
  readonly hash: Hex;
}

/** Where the leader watcher reads its wallets from and stores what it reads. */
export interface LeaderBook {
  /** The wallets the install tracks on the watcher's chain now. */
  tracked(signal: AbortSignal): Promise<readonly TrackedLeader[]>;
  /** The watcher's cursor on its chain, if it has one. */
  cursor(signal: AbortSignal): Promise<WatchCursor | undefined>;
  /**
   * Stores one read in one write: its trades, each once, its overflows, the cursor at its last
   * block, and for each wallet whose `readFrom` it reached, its first block when it had none and
   * its last block read. Resolves once it is stored.
   */
  record(read: LeaderRead, signal: AbortSignal): Promise<void>;
}

/** What the leader watcher of one chain reads with. */
export interface LeaderWatcherOptions {
  readonly rpc: RpcFailover;
  /**
   * The failover the log queries go through, such as one over endpoints that answer
   * `eth_getLogs` (decision 0252); `rpc` when absent.
   */
  readonly logsRpc?: RpcFailover;
  readonly blocks: BlockSource;
  readonly clock: Clock;
  /** Multicall3 on the chain. */
  readonly multicall: Address;
  readonly blockTimeMs: number;
  readonly context: TradeContext;
  /** The quote assets' Chainlink feeds, which value the trades. */
  readonly feeds: readonly FeedAsset[];
  readonly book: LeaderBook;
  /** A node that answers `debug_traceTransaction`, for blocks the others pruned. */
  readonly tracer?: RpcFailover;
  /** How long one endpoint may take to answer one call; the failover's own when absent. */
  readonly callTimeoutMs?: number;
  /** Told the code of each read that failed and will be tried again. */
  readonly onReadFailed?: (code: string) => void;
}

/** Where the watcher stands. */
export interface LeaderWatcherState {
  readonly head?: bigint;
  /** The last block read. */
  readonly read?: bigint;
  /** The code of the last read that failed, until one succeeds. */
  readonly fault?: string;
}

/** Reads the tracked wallets' trades of one chain at every block. */
export interface LeaderWatcher {
  /** Reads every block until the signal aborts; rejects with the signal's reason once it does. */
  run(signal: AbortSignal): Promise<void>;
  state(): LeaderWatcherState;
}

// Behind the head, one read covers this many blocks, the smallest range a provider documents
// for `eth_getLogs` (decision 0250).
const maxSpanBlocks = 10n;
// A node imports a new block within about a third of a block time of the one that announced it.
const notYetRetryMs = 150;

interface Progress {
  head?: bigint;
  cursor?: WatchCursor | undefined;
  isStarted: boolean;
  fault?: string | undefined;
  /** The first block of each wallet seen before the store kept one. */
  readonly firstSeen: Map<AccountRef, bigint>;
}

interface WatcherRun {
  readonly options: LeaderWatcherOptions;
  readonly progress: Progress;
  readonly reader: LeaderReader;
  readonly wake: WakeUp;
  readonly signal: AbortSignal;
}

async function headerAt(
  run: WatcherRun,
  block: bigint | "finalized",
): Promise<BlockHeader | undefined> {
  const header = await requestResult(run.options.rpc, {
    method: "eth_getBlockByNumber",
    params: [block === "finalized" ? block : toHex(block), false],
    result: blockHeaderSchema.nullable(),
    signal: run.signal,
    ...(run.reader.timeoutMs === undefined ? {} : { timeoutMs: run.reader.timeoutMs }),
    ...(block === run.progress.head ? { atHead: true } : {}),
  });
  return header ?? undefined;
}

// The chain's last final block, read again from after a reorganization or a lost cursor. A node
// that answers none fails the read, which is tried again: the watcher never reads on unchecked.
async function finalCursor(run: WatcherRun): Promise<WatchCursor> {
  const final = await headerAt(run, "finalized");
  if (final === undefined) {
    throw new BinferenceError({
      code: "chain.block_missing",
      message: "No node answered the chain's last final block.",
      retryable: true,
    });
  }
  return { block: final.number, hash: final.hash };
}

// The stored cursor while its block still has its hash; else the last final block.
async function startCursor(run: WatcherRun): Promise<WatchCursor | undefined> {
  const stored = await run.options.book.cursor(run.signal);
  if (stored === undefined) {
    return undefined;
  }
  const header = await headerAt(run, stored.block);
  return header?.hash === stored.hash ? stored : finalCursor(run);
}

// Each wallet with its first block and the first block it still needs: the one after its last
// block read, never past the cursor, which a reorganization moves back.
function spanWallets(
  progress: Progress,
  tracked: readonly TrackedLeader[],
  head: bigint,
): readonly SpanWallet[] {
  const { cursor } = progress;
  return tracked.map(({ account, sinceBlock, lastBlock }) => {
    const first = sinceBlock ?? progress.firstSeen.get(account) ?? head;
    if (sinceBlock === undefined) {
      progress.firstSeen.set(account, first);
    } else {
      progress.firstSeen.delete(account);
    }
    if (lastBlock === undefined) {
      return { account, sinceBlock: first, readFrom: first };
    }
    const last = cursor === undefined || lastBlock < cursor.block ? lastBlock : cursor.block;
    return { account, sinceBlock: first, readFrom: last + 1n };
  });
}

// The first block any wallet still needs, and never one at or before the cursor.
function firstBlockOf(cursor: WatchCursor | undefined, wallets: readonly SpanWallet[]): bigint {
  const earliest = wallets
    .map(({ readFrom }) => readFrom)
    .reduce((low, block) => (block < low ? block : low));
  return cursor === undefined || cursor.block + 1n < earliest ? earliest : cursor.block + 1n;
}

async function isOnCursor(run: WatcherRun, from: bigint, to: BlockHeader): Promise<boolean> {
  const { cursor } = run.progress;
  if (cursor === undefined || from !== cursor.block + 1n) {
    return true;
  }
  const first = from === to.number ? to : await headerAt(run, from);
  return first === undefined || first.parentHash === cursor.hash;
}

async function readNext(run: WatcherRun, head: bigint): Promise<"wait" | "not_yet" | "read"> {
  const { options, progress, signal } = run;
  const tracked = await options.book.tracked(signal);
  if (tracked.length === 0) {
    return "wait";
  }
  const wallets = spanWallets(progress, tracked, head);
  const from = firstBlockOf(progress.cursor, wallets);
  if (from > head) {
    return "wait";
  }
  const last = from + maxSpanBlocks - 1n;
  const to = await headerAt(run, last < head ? last : head);
  if (to === undefined) {
    return "not_yet";
  }
  if (!(await isOnCursor(run, from, to))) {
    progress.cursor = await finalCursor(run);
    return "read";
  }
  const span = { from, to: to.number, toHash: to.hash, wallets };
  await options.book.record(await readLeaderSpan(run.reader, span), signal);
  progress.cursor = { block: to.number, hash: to.hash };
  return "read";
}

// Reads on from the cursor: the first time, from where the store's cursor still holds.
async function readFromCursor(run: WatcherRun, head: bigint): Promise<void> {
  const { progress, options } = run;
  if (!progress.isStarted) {
    progress.cursor = await startCursor(run);
    progress.isStarted = true;
  }
  const outcome = await readNext(run, head);
  progress.fault = undefined;
  if (outcome !== "read") {
    const waitMs = outcome === "not_yet" ? notYetRetryMs : options.blockTimeMs;
    await options.clock.sleep(waitMs, run.signal);
  }
}

async function readStep(run: WatcherRun): Promise<undefined> {
  const { progress, options } = run;
  const { head, cursor } = progress;
  if (head === undefined || (cursor !== undefined && cursor.block >= head)) {
    await run.wake.wait(options.blockTimeMs, run.signal);
    return undefined;
  }
  try {
    await readFromCursor(run, head);
  } catch (error) {
    run.signal.throwIfAborted();
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    progress.fault = error.code;
    options.onReadFailed?.(error.code);
    const isAhead = error.code === "chain.block_ahead";
    await options.clock.sleep(isAhead ? notYetRetryMs : options.blockTimeMs, run.signal);
  }
  return undefined;
}

function readerOf(options: LeaderWatcherOptions, signal: AbortSignal): LeaderReader {
  const feeds: ReadonlyMap<AssetRef, FeedAsset> = new Map(
    options.feeds.map((feed) => [feed.asset, feed]),
  );
  return {
    rpc: options.rpc,
    logsRpc: options.logsRpc ?? options.rpc,
    multicall: options.multicall,
    feeds,
    context: options.context,
    signal,
    ...(options.tracer === undefined ? {} : { tracer: options.tracer }),
    ...(options.callTimeoutMs === undefined ? {} : { timeoutMs: options.callTimeoutMs }),
  };
}

// The block source and the reads end together: a fault in either stops both.
async function runWatcher(
  options: LeaderWatcherOptions,
  progress: Progress,
  signal: AbortSignal,
): Promise<void> {
  await runWithHeads(
    options.blocks,
    (shared) => {
      const wake = createWakeUp(options.clock);
      const reader = readerOf(options, shared);
      const run: WatcherRun = { options, progress, reader, wake, signal: shared };
      const onHead = (number: bigint): void => {
        run.progress.head = number;
        wake.wake();
      };
      return { onHead, step: async () => readStep(run) };
    },
    signal,
  );
}

/**
 * Creates the leader watcher of one chain (decisions 0249 and 0250). From its stored cursor, once
 * its block still has its hash, or else from the chain's last final block, it reads every block in
 * order, up to 10 a read behind the head, with no skip: each read's tracked wallets' trades,
 * cut blocks and the cursor go to the book in one write before the next read starts. A read whose
 * first block does not follow the cursor's hash reads again from the last final block. A wallet
 * tracked with no block read yet starts at the head the watcher saw it at. A read that fails is
 * tried again from the same block; the watcher never stops for the chain.
 */
export function createLeaderWatcher(options: LeaderWatcherOptions): LeaderWatcher {
  const progress: Progress = { isStarted: false, firstSeen: new Map() };
  return {
    run: async (signal) => {
      progress.isStarted = false;
      await runWatcher(options, progress, signal);
    },
    state: () => ({
      ...(progress.head === undefined ? {} : { head: progress.head }),
      ...(progress.cursor === undefined ? {} : { read: progress.cursor.block }),
      ...(progress.fault === undefined ? {} : { fault: progress.fault }),
    }),
  };
}
