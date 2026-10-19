import { BinferenceError, type Clock } from "@binference/core";
import { type Hex, toHex } from "viem";
import { type BlockHeader, blockHeaderSchema } from "../leaders/chain-block.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import type { BlockSource } from "./block-source.js";
import { runWithHeads } from "./run-with-heads.js";
import { createWakeUp, type WakeUp } from "./wake-up.js";

/** Where a log watcher stopped: its last block read, and that block's hash. */
export interface WatchCursor {
  readonly block: bigint;
  readonly hash: Hex;
}

/** Blocks one read covers, from `from` to `to`, both included, and the hash of block `to`. */
interface BlockSpan {
  readonly from: bigint;
  readonly to: bigint;
  readonly toHash: Hex;
}

/** What a read needs beyond its blocks, and the first block it reads. */
interface SpanPlan<P> {
  readonly from: bigint;
  readonly plan: P;
}

/** What one log watcher reads and keeps: its cursor, its next read's plan, and the read. */
export interface LogWatchSteps<P> {
  /** The cursor the watcher stored on its chain, if any. */
  cursor(signal: AbortSignal): Promise<WatchCursor | undefined>;
  /**
   * The next read's first block and plan, from the cursor (none before the first read) and the
   * newest block seen; `undefined` while nothing waits to be read.
   */
  plan(
    at: { readonly cursor?: WatchCursor; readonly head: bigint },
    signal: AbortSignal,
  ): Promise<SpanPlan<P> | undefined>;
  /**
   * Reads the span and stores what it found in one write with the cursor at `to`; `head` is the
   * newest block seen. Resolves once it is stored; rejects on a fault, so the span is read again.
   */
  read(
    span: BlockSpan & { readonly plan: P; readonly head: bigint },
    signal: AbortSignal,
  ): Promise<void>;
}

/** What a log watcher of one chain reads with. */
export interface LogWatchOptions<P> {
  readonly rpc: RpcFailover;
  readonly blocks: BlockSource;
  readonly clock: Clock;
  readonly blockTimeMs: number;
  readonly steps: LogWatchSteps<P>;
  /** How long one endpoint may take to answer one call; the failover's own when absent. */
  readonly callTimeoutMs?: number;
  /** Told the code of each read that failed and will be tried again. */
  readonly onReadFailed?: (code: string) => void;
}

/** Where a log watcher stands. */
export interface LogWatchState {
  readonly head?: bigint;
  /** The last block read. */
  readonly read?: bigint;
  /** The code of the last read that failed, until one succeeds. */
  readonly fault?: string;
}

/** Reads one chain's blocks in order, from where it stopped. */
export interface LogWatch {
  /** Reads every block until the signal aborts; rejects with the signal's reason once it does. */
  run(signal: AbortSignal): Promise<void>;
  state(): LogWatchState;
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
}

interface WatchRun<P> {
  readonly options: LogWatchOptions<P>;
  readonly progress: Progress;
  readonly wake: WakeUp;
  readonly signal: AbortSignal;
}

async function headerAt<P>(
  run: WatchRun<P>,
  block: bigint | "finalized",
): Promise<BlockHeader | undefined> {
  const { callTimeoutMs } = run.options;
  const header = await requestResult(run.options.rpc, {
    method: "eth_getBlockByNumber",
    params: [block === "finalized" ? block : toHex(block), false],
    result: blockHeaderSchema.nullable(),
    signal: run.signal,
    ...(callTimeoutMs === undefined ? {} : { timeoutMs: callTimeoutMs }),
    ...(block === run.progress.head ? { atHead: true } : {}),
  });
  return header ?? undefined;
}

// The chain's last final block, read again from after a reorganization or a lost cursor. A node
// that answers none fails the read, which is tried again: the watcher never reads on unchecked.
async function finalCursor<P>(run: WatchRun<P>): Promise<WatchCursor> {
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
async function startCursor<P>(run: WatchRun<P>): Promise<WatchCursor | undefined> {
  const stored = await run.options.steps.cursor(run.signal);
  if (stored === undefined) {
    return undefined;
  }
  const header = await headerAt(run, stored.block);
  return header?.hash === stored.hash ? stored : finalCursor(run);
}

async function isOnCursor<P>(run: WatchRun<P>, from: bigint, to: BlockHeader): Promise<boolean> {
  const { cursor } = run.progress;
  if (cursor === undefined || from !== cursor.block + 1n) {
    return true;
  }
  const first = from === to.number ? to : await headerAt(run, from);
  return first === undefined || first.parentHash === cursor.hash;
}

async function readNext<P>(run: WatchRun<P>, head: bigint): Promise<"wait" | "not_yet" | "read"> {
  const { options, progress, signal } = run;
  const { cursor } = progress;
  const next = await options.steps.plan(cursor === undefined ? { head } : { cursor, head }, signal);
  if (next === undefined || next.from > head) {
    return "wait";
  }
  const { from, plan } = next;
  const last = from + maxSpanBlocks - 1n;
  const to = await headerAt(run, last < head ? last : head);
  if (to === undefined) {
    return "not_yet";
  }
  if (!(await isOnCursor(run, from, to))) {
    progress.cursor = await finalCursor(run);
    return "read";
  }
  await options.steps.read({ from, to: to.number, toHash: to.hash, plan, head }, signal);
  progress.cursor = { block: to.number, hash: to.hash };
  return "read";
}

// Reads on from the cursor: the first time, from where the stored cursor still holds.
async function readFromCursor<P>(run: WatchRun<P>, head: bigint): Promise<void> {
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

async function readStep<P>(run: WatchRun<P>): Promise<undefined> {
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

/**
 * Creates the block reading every log watcher of one chain shares (decision 0250). From its
 * stored cursor, once its block still has its hash, or else from the chain's last final block, it
 * reads every block in order, up to 10 a read behind the head, with no skip: each read is stored
 * with its cursor in one write before the next starts. A read whose first block does not follow
 * the cursor's hash reads again from the last final block. A read that fails with a
 * `BinferenceError` is tried again from the same block, so the watcher never stops for the chain;
 * any other fault stops it.
 */
export function createLogWatch<P>(options: LogWatchOptions<P>): LogWatch {
  const progress: Progress = { isStarted: false };
  return {
    run: async (signal) => {
      progress.isStarted = false;
      // The block source and the reads end together: a fault in either stops both.
      await runWithHeads(
        options.blocks,
        (shared) => {
          const wake = createWakeUp(options.clock);
          const run: WatchRun<P> = { options, progress, wake, signal: shared };
          const onHead = (number: bigint): void => {
            progress.head = number;
            wake.wake();
          };
          return { onHead, step: async () => readStep(run) };
        },
        signal,
      );
    },
    state: () => ({
      ...(progress.head === undefined ? {} : { head: progress.head }),
      ...(progress.cursor === undefined ? {} : { read: progress.cursor.block }),
      ...(progress.fault === undefined ? {} : { fault: progress.fault }),
    }),
  };
}
