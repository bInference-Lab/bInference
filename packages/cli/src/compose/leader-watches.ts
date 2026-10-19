import type {
  AssetRef,
  ChainRef,
  ChainRegistry,
  PriceFeedDefinition,
  RegisteredChain,
} from "@binference/chain";
import {
  createBlockSource,
  createLeaderWatcher,
  feedAssetsOf,
  hexSchema,
  type LeaderBook,
  type LeaderRead,
  parseEvmAddress,
  type TradeContext,
} from "@binference/chain-evm";
import { type Clock, createDeadline, type Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import {
  activityItemOf,
  type LeaderReadRecord,
  type StoredActivity,
  type TrackedWalletStore,
} from "@binference/engine/orders";
import { assetInfosOf } from "@binference/engine/surfaces";
import type { Address } from "viem";
import type { ChainReads } from "./chain-reads.js";
import type { Closers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";
import { createWatcherRunner, type WatcherRunner } from "./watcher-runner.js";

/** The leader watchers as the engine serves them: their link to the alerts, and their start. */
export interface ComposedLeaderWatchers {
  /** Hands each trade the watchers store from now on to the engine's wallet alerts. */
  readonly attach: (engine: Pick<Engine, "alerts">) => void;
  /** Runs each chain's watcher while the install tracks a wallet on it. */
  readonly start: (closers: Closers, logger: Logger) => void;
}

/** What the leader watchers read and where they store. */
export interface LeaderWatchersOptions {
  readonly chains: ChainRegistry;
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  /** The Chainlink feeds of each chain, which mark its quote assets and value the trades. */
  readonly feeds: ReadonlyMap<ChainRef, readonly PriceFeedDefinition[]>;
  readonly tracked: TrackedWalletStore;
  readonly clock: Clock;
}

// A read of every block gives one endpoint this long, about three blocks on BNB Smart Chain,
// before the next is asked (decision 0250).
const callTimeoutMs = 1_500;
// Whether a chain has a tracked wallet is read this often, and given this long.
const syncEveryMs = 5_000;
const syncTimeoutMs = 10_000;

/** Where the stored trades go once the engine exists, and where the watchers log. */
interface Links {
  alerts?: Pick<Engine, "alerts">["alerts"];
  logger?: Logger;
}

// The registry's venue of each contract a trade may call.
function venuesOf(chain: RegisteredChain): ReadonlyMap<Address, string> {
  return new Map(
    chain.definition.contracts.flatMap(({ address, venue }) => {
      const parsed = parseEvmAddress(address);
      return parsed.ok ? [[parsed.value, venue] as const] : [];
    }),
  );
}

function contextOf(
  reads: ChainReads,
  feeds: readonly { readonly asset: AssetRef }[],
): TradeContext {
  const quotes = new Set([reads.evm.nativeAsset, ...feeds.map(({ asset }) => asset)]);
  return { chain: reads.evm, quotes, venues: venuesOf(reads.chain) };
}

function recordOf(chain: ChainRef, read: LeaderRead, atMs: number): LeaderReadRecord {
  return {
    chain,
    from: read.from,
    to: read.to,
    toHash: read.toHash,
    atMs,
    wallets: read.wallets,
    trades: read.trades.map(({ blockHash: _hash, ...trade }) => trade),
    overflows: read.overflows.map(({ account, block }) => ({ account, block })),
  };
}

// Each stored trade goes to the wallet alerts once; an alert that fails is logged and the watcher
// goes on, since the trade is stored.
async function seeTrades(
  links: Links & { readonly chains: ChainRegistry; readonly chain: ChainRef },
  stored: { readonly trades: readonly StoredActivity[]; readonly signal: AbortSignal },
): Promise<void> {
  const { alerts, logger, chain } = links;
  const { signal } = stored;
  const see = async (trade: StoredActivity): Promise<void> => {
    const assets = assetInfosOf(links.chains, [trade.asset, trade.counterAsset]);
    const activity = activityItemOf(trade);
    try {
      await alerts?.seeTrade({ account: trade.account, activity, assets }, { signal });
    } catch {
      signal.throwIfAborted();
      logger?.warn("engine.alert_trade_failed", { chain, accountId: trade.account });
    }
  };
  // In the order the trades happened, one after another.
  await stored.trades.reduce(async (seen, trade) => {
    await seen;
    await see(trade);
  }, Promise.resolve());
}

function bookOf(options: LeaderWatchersOptions, reads: ChainReads, links: Links): LeaderBook {
  const { tracked, clock } = options;
  const chain = reads.chain.ref;
  return {
    tracked: async (signal) => tracked.tracked(chain, { signal }),
    cursor: async (signal) => {
      const cursor = await tracked.cursor(chain, { signal });
      const hash = hexSchema.safeParse(cursor?.blockHash);
      return cursor === undefined || !hash.success
        ? undefined
        : { block: cursor.block, hash: hash.data };
    },
    async record(read, signal) {
      const trades = await tracked.record(recordOf(chain, read, clock.now()), { signal });
      for (const { account } of read.overflows) {
        links.logger?.warn("watcher.wallet_overflow", { chain, accountId: account });
      }
      await seeTrades({ ...links, chains: options.chains, chain }, { trades, signal });
    },
  };
}

interface ChainLeaderWatch {
  readonly chain: ChainRef;
  readonly runner: WatcherRunner;
  /** Whether the install tracks a wallet on the chain, by chain, at the last sync. */
  readonly wanted: Map<ChainRef, boolean>;
}

function watchOf(
  options: LeaderWatchersOptions,
  reads: ChainReads,
  wiring: { readonly links: Links; readonly logger: Logger },
): ChainLeaderWatch {
  const { clock } = options;
  const { rpc, multicall, chain } = reads;
  const { blockTimeMs } = chain.definition;
  const { links, logger } = wiring;
  const feeds = feedAssetsOf(chain.definition, options.feeds.get(chain.ref) ?? []);
  const failures = { last: "" };
  const watcher = createLeaderWatcher({
    rpc,
    blocks: createBlockSource({ rpc, clock, blockTimeMs, callTimeoutMs }),
    clock,
    multicall,
    blockTimeMs,
    context: contextOf(reads, feeds),
    feeds,
    book: bookOf(options, reads, links),
    callTimeoutMs,
    // A read that fails again for the same reason is not logged again.
    onReadFailed: (errorCode) => {
      if (errorCode !== failures.last) {
        failures.last = errorCode;
        logger.warn("watcher.leader_read_failed", { chain: chain.ref, errorCode });
      }
    },
  });
  const wanted = new Map<ChainRef, boolean>();
  const isWanted = (): boolean => wanted.get(chain.ref) === true;
  const runner = createWatcherRunner({ chain, watcher, clock, logger, isWanted });
  return { chain: chain.ref, runner, wanted };
}

// Runs each chain's watcher while a wallet is tracked on it, and stops it once none is.
async function syncWatches(
  options: LeaderWatchersOptions,
  watches: readonly ChainLeaderWatch[],
  signal: AbortSignal,
): Promise<void> {
  const deadline = createDeadline({ clock: options.clock, signal, timeoutMs: syncTimeoutMs });
  try {
    await Promise.all(
      watches.map(async (watch) => {
        const tracked = await options.tracked.tracked(watch.chain, { signal: deadline.signal });
        const isTracking = tracked.length > 0;
        watch.wanted.set(watch.chain, isTracking);
        return isTracking ? watch.runner.ensure() : watch.runner.stop();
      }),
    );
  } finally {
    deadline.clear();
  }
}

/**
 * The leader watchers' part of the engine (decisions 0249 to 0251): one leader watcher per chain
 * the engine reads, run while the install tracks a wallet on it, synced every 5 seconds, over the
 * chain's RPC failover, whose endpoints must answer `eth_getLogs`. Each read lands in the tracked
 * wallet store in one write; each trade stored new goes to the engine's wallet alerts. A cut
 * block is logged as `watcher.wallet_overflow` with the chain and the account, and a read that
 * fails as `watcher.leader_read_failed` once for each new reason.
 */
export function composeLeaderWatchers(options: LeaderWatchersOptions): ComposedLeaderWatchers {
  const links: Links = {};
  return {
    attach(engine) {
      links.alerts = engine.alerts;
    },
    start(closers, logger) {
      links.logger = logger;
      const watches = [...options.reads.values()].map((reads) =>
        watchOf(options, reads, { links, logger }),
      );
      // Added before the timer, so the shutdown stops the timer first, then the watchers.
      closers.add("leader_watchers", async () => {
        await Promise.all(watches.map(async ({ runner }) => runner.stop()));
      });
      startRepeatingTimer({
        name: "leader_sync",
        everyMs: syncEveryMs,
        failedEvent: "engine.leader_sync_failed",
        isLocked: () => false,
        clock: options.clock,
        closers,
        logger,
        run: async ({ signal }) => syncWatches(options, watches, signal),
      });
    },
  };
}
