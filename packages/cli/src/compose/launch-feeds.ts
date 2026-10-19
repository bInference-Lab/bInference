import type { ChainRef, ChainRegistry } from "@binference/chain";
import {
  createBlockSource,
  createLaunchWatcher,
  type FeedLaunch,
  hexSchema,
  type LaunchBook,
  type LaunchRead,
} from "@binference/chain-evm";
import type { Clock, Logger } from "@binference/core";
import type { Engine, EnginePush, VenueHost } from "@binference/engine";
import {
  type LaunchReadRecord,
  type LaunchStore,
  type NewLaunch,
  type StoredLaunch,
  tellLaunches,
} from "@binference/engine/market";
import type { ChainReads } from "./chain-reads.js";
import type { Closers } from "./closers.js";
import { createWatcherRunner, type WatcherRunner } from "./watcher-runner.js";

/** The launch feeds as the engine serves them: whether any runs, their link to the alerts, and their start. */
export interface ComposedLaunchFeeds {
  /** Whether a feed runs on some chain: `market/scan` reads launches only then. */
  readonly isRunning: boolean;
  /** Hands each launch the feeds store from now on to the engine's launch alerts. */
  readonly attach: (engine: Pick<Engine, "alerts">) => void;
  /** Runs each chain's feed until the shutdown. */
  readonly start: (closers: Closers, logger: Logger) => void;
}

/** What the launch feeds read, where they store, and where they tell. */
export interface LaunchFeedsOptions {
  readonly chains: ChainRegistry;
  readonly reads: ReadonlyMap<ChainRef, ChainReads>;
  /** The venue host over the engine's venues; its launchpads that read launches are fed. */
  readonly host: Pick<VenueHost, "launchReaders">;
  readonly launches: LaunchStore;
  /** Where each `launch/new` goes, once the engine's publish exists. */
  readonly publish: (push: EnginePush) => void;
  readonly clock: Clock;
}

// A read of every block gives one endpoint this long, about three blocks on BNB Smart Chain,
// before the next is asked, as the leader watcher does (decision 0250).
const callTimeoutMs = 1_500;

// Before the engine is attached no launch alert exists to fire.
const noAlerts: Pick<Engine["alerts"], "seeLaunch"> = {
  seeLaunch: async () => Promise.resolve([]),
};

/** Where the stored launches go once the engine exists, and where the feeds log. */
interface Links {
  alerts?: Pick<Engine["alerts"], "seeLaunch">;
  logger?: Logger;
}

function newLaunchOf(launch: FeedLaunch): NewLaunch {
  const { launchpad, token, creator, quoteAsset, graduated, insiders } = launch;
  const { block, blockHash, txHash, logIndex, launchedAtMs } = launch;
  const { symbol, name, decimals, taxBps, snipeTaxBps, curveProgressBps } = launch;
  return {
    token,
    launchpad,
    creator,
    quoteToken: quoteAsset,
    ...(symbol === undefined ? {} : { symbol }),
    ...(name === undefined ? {} : { name }),
    ...(decimals === undefined ? {} : { decimals }),
    ...(taxBps === undefined ? {} : { taxBps }),
    ...(snipeTaxBps === undefined ? {} : { snipeTaxBps }),
    ...(curveProgressBps === undefined ? {} : { curveProgressBps }),
    graduated,
    insiders,
    block,
    blockHash,
    txHash,
    logIndex,
    launchedAtMs,
  };
}

function recordOf(chain: ChainRef, read: LaunchRead, atMs: number): LaunchReadRecord {
  return {
    chain,
    from: read.from,
    to: read.to,
    toHash: read.toHash,
    atMs,
    launches: read.launches.map(newLaunchOf),
    changes: read.changes.map(({ index: _index, ...change }) => change),
  };
}

function bookOf(options: LaunchFeedsOptions, chain: ChainRef, links: Links): LaunchBook {
  const { launches, clock } = options;
  return {
    cursor: async (signal) => {
      const cursor = await launches.cursor(chain, { signal });
      const hash = hexSchema.safeParse(cursor?.blockHash);
      return cursor === undefined || !hash.success
        ? undefined
        : { block: cursor.block, hash: hash.data };
    },
    async record(read, signal) {
      const stored = await launches.record(recordOf(chain, read, clock.now()), { signal });
      const { alerts = noAlerts, logger } = links;
      const parts = {
        chains: options.chains,
        publish: options.publish,
        alerts,
        onAlertFailed: (launch: StoredLaunch) =>
          logger?.warn("engine.alert_launch_failed", { chain, assetId: launch.token }),
      };
      await tellLaunches(parts, stored, { signal });
    },
  };
}

function runnerOf(
  options: LaunchFeedsOptions,
  reads: ChainReads,
  wiring: { readonly links: Links; readonly logger: Logger },
): WatcherRunner | undefined {
  const { chain, rpc, multicall } = reads;
  const launchpads = options.host.launchReaders(chain.ref);
  if (launchpads.length === 0) {
    return undefined;
  }
  const { clock } = options;
  const { blockTimeMs } = chain.definition;
  const { logger } = wiring;
  const failures = { last: "" };
  const watcher = createLaunchWatcher({
    chain: reads.evm,
    rpc,
    logsRpc: reads.logsRpc,
    blocks: createBlockSource({ rpc, clock, blockTimeMs, callTimeoutMs }),
    clock,
    multicall,
    blockTimeMs,
    launchpads,
    book: bookOf(options, chain.ref, wiring.links),
    callTimeoutMs,
    // A read that fails again for the same reason is not logged again.
    onReadFailed: (errorCode) => {
      if (errorCode !== failures.last) {
        failures.last = errorCode;
        logger.warn("watcher.launch_read_failed", { chain: chain.ref, errorCode });
      }
    },
  });
  return createWatcherRunner({ chain, watcher, clock, logger, isWanted: () => true });
}

/**
 * The launch feeds' part of the engine (decision 0256): one launch feed per chain the engine
 * reads whose venues hold a launchpad that reads launches, run from the start until the
 * shutdown, over the chain's RPC failover and its log endpoints. Each read lands in the launch
 * store in one write; each launch stored new is pushed as `launch/new` and handed to the launch
 * alerts once the engine is attached. A read that fails is logged as
 * `watcher.launch_read_failed` once for each new reason; a launch whose alerts failed as
 * `engine.alert_launch_failed`.
 */
export function composeLaunchFeeds(options: LaunchFeedsOptions): ComposedLaunchFeeds {
  const links: Links = {};
  const chains = [...options.reads.values()];
  const isRunning = chains.some((reads) => options.host.launchReaders(reads.chain.ref).length > 0);
  return {
    isRunning,
    attach(engine) {
      links.alerts = engine.alerts;
    },
    start(closers, logger) {
      links.logger = logger;
      const runners = chains.flatMap((reads) => runnerOf(options, reads, { links, logger }) ?? []);
      closers.add("launch_feeds", async () => {
        await Promise.all(runners.map(async (runner) => runner.stop()));
      });
      for (const runner of runners) {
        runner.ensure();
      }
    },
  };
}
