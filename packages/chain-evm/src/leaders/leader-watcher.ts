import type { AccountRef, AssetRef } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { Address } from "viem";
import type { FeedAsset } from "../prices/price-from-round.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import type { BlockSource } from "../watching/block-source.js";
import {
  createLogWatch,
  type LogWatch,
  type LogWatchState,
  type LogWatchSteps,
  type WatchCursor,
} from "../watching/log-watch.js";
import type { LeaderReader } from "./leader-reader.js";
import type { TradeContext } from "./match-trades.js";
import { type LeaderRead, readLeaderSpan, type SpanWallet } from "./read-leader-span.js";

/** A tracked wallet as the store keeps it: the first and the last block read of it. */
export interface TrackedLeader {
  readonly account: AccountRef;
  readonly sinceBlock?: bigint;
  readonly lastBlock?: bigint;
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
export type LeaderWatcherState = LogWatchState;

/** Reads the tracked wallets' trades of one chain at every block. */
export type LeaderWatcher = LogWatch;

interface LeaderProgress {
  /** The first block of each wallet seen before the store kept one. */
  readonly firstSeen: Map<AccountRef, bigint>;
}

// Each wallet with its first block and the first block it still needs: the one after its last
// block read, never past the cursor, which a reorganization moves back.
function spanWallets(
  progress: LeaderProgress,
  tracked: readonly TrackedLeader[],
  at: { readonly cursor?: WatchCursor; readonly head: bigint },
): readonly SpanWallet[] {
  const { cursor, head } = at;
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

/**
 * Creates the leader watcher of one chain (decisions 0249 and 0250), on the block reading every
 * log watcher shares (`createLogWatch`): every block in order, up to 10 a read behind the head,
 * with no skip, each read's tracked wallets' trades, cut blocks and the cursor stored in one
 * write before the next read starts. A wallet tracked with no block read yet starts at the head
 * the watcher saw it at. A read that fails is tried again from the same block; the watcher never
 * stops for the chain.
 */
export function createLeaderWatcher(options: LeaderWatcherOptions): LeaderWatcher {
  const progress: LeaderProgress = { firstSeen: new Map() };
  const steps: LogWatchSteps<readonly SpanWallet[]> = {
    cursor: async (signal) => options.book.cursor(signal),
    async plan(at, signal) {
      const tracked = await options.book.tracked(signal);
      if (tracked.length === 0) {
        return undefined;
      }
      const wallets = spanWallets(progress, tracked, at);
      return { from: firstBlockOf(at.cursor, wallets), plan: wallets };
    },
    async read({ plan: wallets, from, to, toHash }, signal) {
      const span = { from, to, toHash, wallets };
      const read = await readLeaderSpan(readerOf(options, signal), span);
      await options.book.record(read, signal);
    },
  };
  return createLogWatch({ ...options, steps });
}
