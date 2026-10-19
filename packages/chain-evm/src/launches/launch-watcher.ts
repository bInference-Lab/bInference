import type { Clock } from "@binference/core";
import type { Address } from "viem";
import type { EvmChain } from "../evm-chain.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import type { BlockSource } from "../watching/block-source.js";
import {
  createLogWatch,
  type LogWatch,
  type LogWatchSteps,
  type WatchCursor,
} from "../watching/log-watch.js";
import { type FeedLaunchpad, type LaunchRead, readLaunchSpan } from "./read-launch-span.js";

/** Where the launch feed stores what it reads, and where it stopped. */
export interface LaunchBook {
  /** The feed's cursor on its chain, if it has one. */
  cursor(signal: AbortSignal): Promise<WatchCursor | undefined>;
  /**
   * Stores one read in one write: its launches, each once, its curve changes, and the cursor at its
   * last block. Resolves once it is stored and each launch stored new was told.
   */
  record(read: LaunchRead, signal: AbortSignal): Promise<void>;
}

/** What the launch feed of one chain reads with. */
export interface LaunchWatcherOptions {
  readonly chain: EvmChain;
  readonly rpc: RpcFailover;
  /**
   * The failover the log query goes through, such as one over endpoints that answer
   * `eth_getLogs` (decision 0252); `rpc` when absent.
   */
  readonly logsRpc?: RpcFailover;
  readonly blocks: BlockSource;
  readonly clock: Clock;
  /** Multicall3 on the chain, which asks the completing reads. */
  readonly multicall: Address;
  readonly blockTimeMs: number;
  /** The launchpads whose launches the feed reads, each with its contracts on the chain. */
  readonly launchpads: readonly FeedLaunchpad[];
  readonly book: LaunchBook;
  /** How long one endpoint may take to answer one call; the failover's own when absent. */
  readonly callTimeoutMs?: number;
  /** Told the code of each read that failed and will be tried again. */
  readonly onReadFailed?: (code: string) => void;
}

/**
 * Creates the launch feed of one chain (decision 0256), on the block reading every log watcher
 * shares (`createLogWatch`): from its stored cursor, or from the newest block the first time, it
 * reads every block in order, up to 10 a read behind the head, with no skip; each read's launches,
 * curve changes and cursor reach the book in one write before the next read starts, so a restart
 * after an outage reads on from the block after the last one stored, with no gap and no double. A
 * read whose first block does not follow the stored one reads again from the last final block. A
 * read that fails is tried again from the same block; the feed never stops for the chain. With no
 * launchpad, it reads nothing.
 */
export function createLaunchWatcher(options: LaunchWatcherOptions): LogWatch {
  const { chain, rpc, multicall, launchpads } = options;
  const steps: LogWatchSteps<undefined> = {
    cursor: async (signal) => options.book.cursor(signal),
    plan: async ({ cursor, head }) =>
      launchpads.length === 0
        ? undefined
        : { from: cursor === undefined ? head : cursor.block + 1n, plan: undefined },
    async read({ from, to, toHash, head }, signal) {
      const reader = {
        chain,
        rpc,
        logsRpc: options.logsRpc ?? rpc,
        multicall,
        launchpads,
        signal,
        ...(options.callTimeoutMs === undefined ? {} : { timeoutMs: options.callTimeoutMs }),
      };
      const read = await readLaunchSpan(reader, { from, to, toHash, atHead: to === head });
      await options.book.record(read, signal);
    },
  };
  return createLogWatch({ ...options, steps });
}
