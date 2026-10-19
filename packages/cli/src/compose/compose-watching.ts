import type { ChainRef } from "@binference/chain";
import { createVenueHost, type EnginePush } from "@binference/engine";
import type { ChainReads } from "./chain-reads.js";
import { composeChainWatches } from "./chain-watches.js";
import { type ComposedPriceWatchers, composePriceWatchers } from "./compose-price-watchers.js";
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
  /** Where the watchers' notices go, set once the engine's publish exists. */
  readonly watcherPushes: { publish: (push: EnginePush) => void };
}

// A venue's price read gets this long, as a quote does.
const priceReadTimeoutMs = 5_000;

/**
 * One price watcher per chain over the chain's reads, the venues' price reads and the shared
 * market sources (decisions 0192 and 0193), and one leader watcher per chain over its reads. A watcher's `wss:` RPC opens through Node's own
 * WebSocket; its URL is the owner's secret, so nothing logs it.
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
  const leaderWatchers = composeLeaderWatchers({
    chains: opened.chains,
    reads,
    feeds: selfHostedFeeds(),
    tracked: opened.stores.trackedWallets,
    notices: {
      alerts: opened.stores.alerts,
      orders: opened.stores.orders,
      agents: opened.stores.agents,
      publish: (push) => watcherPushes.publish(push),
    },
    clock,
  });
  return { sources, priceWatchers, leaderWatchers, watcherPushes };
}
