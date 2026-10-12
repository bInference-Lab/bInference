import type { AssetRef, ChainRef } from "@binference/chain";
import type {
  PriceCheck,
  PriceCrossCheck,
  WatcherLagAlerts,
  WatcherUnpricedAlerts,
} from "@binference/engine/market";
import type { ChainWatch } from "./chain-watch.js";
import type { HealthSignal } from "./health-signals.js";
import { isConfirmed } from "./price-confirmation.js";

/** What the watchers' health is read from each second, and where its notices go. */
export interface WatcherChecks {
  readonly lag: WatcherLagAlerts;
  readonly unpriced: WatcherUnpricedAlerts;
  /** When each watched token of each chain went without a confirmed price. */
  readonly unpricedSince: Map<ChainRef, ReadonlyMap<AssetRef, number>>;
  /** The cross-check's checks now. */
  readonly checks: () => readonly PriceCheck[];
  /**
   * The watched tokens' decimals read so far: a price of a token without them fires no trigger,
   * so the token counts as unpriced (decision 0197).
   */
  readonly decimals: ReadonlyMap<AssetRef, number>;
}

// A token without a confirmed price this long counts as unpriced (decision 0194).
const unpricedAfterMs = 60_000;
// A lag past this many blocks shows as this many.
const maxShownLag = 1_000_000n;

// The watched tokens of a running chain that have had no confirmed price for a minute.
function unpricedOn(
  checks: WatcherChecks,
  watched: { readonly chain: ChainRef; readonly watch: ChainWatch },
  nowMs: number,
): readonly AssetRef[] {
  const known = checks.checks();
  const confirmed = new Set(
    watched.watch
      .latest()
      .filter((price) => checks.decimals.has(price.token) && isConfirmed(price, known, nowMs))
      .map(({ token }) => token),
  );
  const before = checks.unpricedSince.get(watched.chain);
  const since = new Map(
    watched.watch.watcher
      .tokens()
      .filter(({ token }) => !confirmed.has(token))
      .map(({ token }) => [token, before?.get(token) ?? nowMs] as const),
  );
  checks.unpricedSince.set(watched.chain, since);
  return [...since].flatMap(([token, atMs]) => (nowMs - atMs >= unpricedAfterMs ? [token] : []));
}

/**
 * Reads each chain's watcher once: its lag, or that it is down, and the watched tokens without a
 * confirmed price for a minute; a chain that watches nothing is forgotten.
 */
export function checkWatchers(
  watches: ReadonlyMap<ChainRef, ChainWatch>,
  checks: WatcherChecks,
  atMs: number,
): void {
  for (const [chain, watch] of watches) {
    const chainName = watch.chain.definition.name;
    if (watch.downSinceMs() !== undefined) {
      checks.lag.check({ chain, chainName, lagBlocks: 0n, atMs, isDown: true });
    } else if (watch.isRunning()) {
      checks.lag.check({ chain, chainName, lagBlocks: watch.watcher.lag().lagBlocks, atMs });
      const tokens = unpricedOn(checks, { chain, watch }, atMs);
      checks.unpriced.check({ chain, chainName, tokens, atMs });
    } else {
      checks.lag.forget(chain);
      checks.unpriced.forget(chain);
      checks.unpricedSince.delete(chain);
    }
  }
}

// A price 10% or more away from a data source's, or a token without a price, warns.
function isWarned(
  checks: WatcherChecks,
  cross: PriceCrossCheck | undefined,
  watches: ReadonlyMap<ChainRef, ChainWatch>,
): boolean {
  const watched = [...watches.values()].flatMap((watch) =>
    watch.latest().map(({ token }) => token),
  );
  const hasGap = cross !== undefined && watched.some((token) => cross.hasGap(token));
  return hasGap || checks.unpriced.count().count > 0;
}

/**
 * The `watcher` health signal: the worst chain's lag, warning at least while a price is 10% or
 * more away from a data source's or a watched token has had no price for a minute, with how many.
 */
export function watcherHealthOf(
  checks: WatcherChecks,
  cross: PriceCrossCheck | undefined,
  watches: ReadonlyMap<ChainRef, ChainWatch>,
): HealthSignal {
  const lag = checks.lag.health();
  const isWarn = isWarned(checks, cross, watches);
  if (lag === undefined) {
    return { signal: "watcher", state: isWarn ? "warn" : "ok" };
  }
  const unpriced = checks.unpriced.count();
  const state = lag.state === "ok" && isWarn ? "warn" : lag.state;
  const since = lag.since ?? unpriced.sinceMs;
  const lagBlocks = Number(lag.lagBlocks > maxShownLag ? maxShownLag : lag.lagBlocks);
  return {
    signal: "watcher",
    state,
    ...(state === "ok" || since === undefined ? {} : { since }),
    lagBlocks,
    ...(unpriced.count === 0 ? {} : { unpricedTokens: unpriced.count }),
  };
}
