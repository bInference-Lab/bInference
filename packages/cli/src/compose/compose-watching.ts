import type { ChainRef } from "@binference/chain";
import type { Clock } from "@binference/core";
import {
  createVenueHost,
  type Engine,
  type EngineOptions,
  type EnginePush,
  type VenueHost,
} from "@binference/engine";
import type { ChainReads } from "./chain-reads.js";
import { composeChainWatches } from "./chain-watches.js";
import { type ComposedPriceWatchers, composePriceWatchers } from "./compose-price-watchers.js";
import { type ComposedLaunchFeeds, composeLaunchFeeds } from "./launch-feeds.js";
import { type ComposedLeaderWatchers, composeLeaderWatchers } from "./leader-watches.js";
import { type SelfHostedSources, selfHostedSources } from "./market-reads.js";
import { type Opened, type Opening, selfHostedFeeds } from "./open-engine-parts.js";
import { chainTokenDecimals } from "./token-decimals.js";

/** The self-hosted engine's market sources and price watchers, before its publish exists. */
export interface ComposedWatching {
  /** The market data sources, one of each, which the market reads and the watchers share. */
  readonly sources: SelfHostedSources;
  readonly priceWatchers: ComposedPriceWatchers;
  /** The leader watchers, which read the tracked wallets' trades (decisions 0249 to 0251). */
  readonly leaderWatchers: ComposedLeaderWatchers;
  /** The launch feeds, which record each launchpad's new tokens (decision 0256). */
  readonly launchFeeds: ComposedLaunchFeeds;
  /** Where the watchers' notices go, set once the engine's publish exists. */
  readonly watcherPushes: { publish: (push: EnginePush) => void };
  /** What the engine takes from the watchers: whether a launch feed runs, and the quote assets. */
  readonly watchedParts: Pick<EngineOptions, "launchFeed" | "quoteAssets">;
}

// A venue's price read gets this long, as a quote does.
const priceReadTimeoutMs = 5_000;

// The watchers that read new blocks' logs: the leader watchers and the launch feeds.
function composeLogWatchers(
  opened: Opened,
  parts: {
    readonly reads: ReadonlyMap<ChainRef, ChainReads>;
    readonly host: VenueHost;
    readonly clock: Clock;
    readonly publish: (push: EnginePush) => void;
  },
): Pick<ComposedWatching, "leaderWatchers" | "launchFeeds"> {
  const { reads, host, clock, publish } = parts;
  const { chains, stores } = opened;
  const { alerts, orders, agents } = stores;
  return {
    leaderWatchers: composeLeaderWatchers({
      chains,
      reads,
      feeds: selfHostedFeeds(),
      tracked: stores.trackedWallets,
      notices: { alerts, orders, agents, publish },
      clock,
    }),
    launchFeeds: composeLaunchFeeds({
      chains,
      reads,
      host,
      launches: stores.launches,
      publish,
      clock,
    }),
  };
}

/**
 * One price watcher per chain over the chain's reads, the venues' price reads and the shared
 * market sources (decisions 0192 and 0193), one leader watcher per chain over its reads, and one
 * launch feed per chain whose launchpads read launches (decision 0256). A watcher's `wss:` RPC
 * opens through Node's own WebSocket; its URL is the owner's secret, so nothing logs it.
 */
export function composeWatching(
  opening: Opening,
  opened: Opened,
  reads: ReadonlyMap<ChainRef, ChainReads>,
): ComposedWatching {
  const { clock } = opening.host;
  const sources = selfHostedSources({ http: opening.host.http, clock });
  const venues = createVenueHost({
    venues: opened.venues,
    chains: opened.chains,
    clock,
    callTimeoutMs: priceReadTimeoutMs,
  });
  const watches = composeChainWatches({
    reads,
    venues,
    feeds: selfHostedFeeds(),
    headSockets: opened.headSockets,
    openSocket: (url) => new WebSocket(url),
    clock,
    logger: opened.log.logger.child("watcher"),
  });
  const watcherPushes = { publish: (_push: EnginePush): void => undefined };
  const priceWatchers = composePriceWatchers({
    watches,
    decimals: chainTokenDecimals(reads),
    orders: opened.stores.orders,
    alerts: opened.stores.alerts,
    sources,
    clock,
    publish: (push) => watcherPushes.publish(push),
  });
  const publish = (push: EnginePush): void => watcherPushes.publish(push);
  const logWatchers = composeLogWatchers(opened, { reads, host: venues, clock, publish });
  const watchedParts = {
    launchFeed: logWatchers.launchFeeds.isRunning,
    quoteAssets: logWatchers.leaderWatchers.quotes,
  };
  return { sources, priceWatchers, ...logWatchers, watcherPushes, watchedParts };
}

/** The watchers the engine serves: its price and leader watchers and its launch feeds. */
export type ServedWatching = Pick<
  ComposedWatching,
  "priceWatchers" | "leaderWatchers" | "launchFeeds"
>;

/**
 * Hands what each watcher of the composed watching reads from now on to the engine's alerts and
 * orders, and answers the watchers the engine serves.
 */
export function serveWatching(watching: ServedWatching, engine: Engine): ServedWatching {
  const { priceWatchers, leaderWatchers, launchFeeds } = watching;
  priceWatchers.attach(engine);
  leaderWatchers.attach(engine);
  launchFeeds.attach(engine);
  return { priceWatchers, leaderWatchers, launchFeeds };
}
