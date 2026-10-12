import type { AssetRef, ChainRef, MarketDataSource } from "@binference/chain";
import { type Clock, createDeadline, type Logger } from "@binference/core";
import type { EnginePush } from "@binference/engine";
import {
  createPriceCrossCheck,
  createWatcherLagAlerts,
  type PriceCrossCheck,
  type PriceSample,
  type WatcherLagAlerts,
} from "@binference/engine/market";
import type { OrderStore } from "@binference/engine/orders";
import type { ChainWatch } from "./chain-watch.js";
import type { Closers } from "./closers.js";
import type { HealthSignal } from "./health-signals.js";
import { startRepeatingTimer } from "./repeating-timer.js";
import type { ReadDecimals } from "./token-decimals.js";
import { createWatchedOrders, type WatchedOrders } from "./watched-orders.js";

/** The price watchers as the engine serves them: their health, and their timers to start. */
export interface ComposedPriceWatchers {
  /** The `watcher` health signal, with its lag in blocks while a watcher reads. */
  readonly health: () => HealthSignal;
  /** How many active orders with a price trigger the watchers read for, at the last sync. */
  readonly activeOrders: () => number;
  /** Starts following the active orders, the lag checks and the cross-check. */
  readonly start: (closers: Closers, logger: Logger) => void;
}

/** What the composed watchers read and where they report. */
export interface PriceWatchersOptions {
  readonly watches: ReadonlyMap<ChainRef, ChainWatch>;
  /** Reads the watched tokens' decimals, which the cross-check needs to compare whole tokens. */
  readonly decimals: ReadDecimals;
  readonly orders: Pick<OrderStore, "list">;
  /**
   * The data sources the cross-check samples (decision 0193): DEX Screener each minute, and the
   * GeckoTerminal source the charts read through, every five minutes for at most 30 tokens, so the
   * cross-check takes about one of its ten calls a minute in five.
   */
  readonly sources: {
    readonly dexscreener: MarketDataSource;
    readonly geckoterminal: MarketDataSource;
  };
  readonly clock: Clock;
  readonly publish: (push: EnginePush) => void;
}

// The lag is read each second; the active orders every five seconds; the cross-check's sources
// at their own pace, looked at every 15 seconds.
const lagEveryMs = 1_000;
const syncEveryMs = 5_000;
const crossCheckEveryMs = 15_000;
const gapLimitBps = 1_000;
// A round of the cross-check gives up past this, each source's wait for its turn included.
const crossCheckTimeoutMs = 30_000;
// A lag past this many blocks shows as this many.
const maxShownLag = 1_000_000n;

/** The decimals of the watched tokens, each read once. */
interface DecimalsBook {
  readonly known: Map<AssetRef, number>;
  read(tokens: readonly AssetRef[], signal: AbortSignal): Promise<void>;
}

function decimalsBookOf(readDecimals: ReadDecimals): DecimalsBook {
  const known = new Map<AssetRef, number>();
  return {
    known,
    async read(tokens, signal) {
      const unknown = tokens.filter((token) => !known.has(token));
      if (unknown.length > 0) {
        for (const [token, value] of await readDecimals(unknown, signal)) {
          known.set(token, value);
        }
      }
    },
  };
}

function samplesOf(
  watches: ReadonlyMap<ChainRef, ChainWatch>,
  decimals: DecimalsBook,
): readonly PriceSample[] {
  return [...watches.values()].flatMap((watch) =>
    watch.latest().flatMap(({ token, usdPrice }) => {
      const tokenDecimals = decimals.known.get(token);
      return usdPrice === undefined || tokenDecimals === undefined
        ? []
        : [{ token, usdPrice, decimals: tokenDecimals }];
    }),
  );
}

function crossCheckOf(
  options: PriceWatchersOptions,
  decimals: DecimalsBook,
  logger: Logger,
): PriceCrossCheck {
  const { dexscreener, geckoterminal } = options.sources;
  return createPriceCrossCheck({
    sources: [
      { source: dexscreener, everyMs: 60_000, maxTokens: 90 },
      { source: geckoterminal, everyMs: 300_000, maxTokens: 30 },
    ],
    samples: () => samplesOf(options.watches, decimals),
    gapLimitBps,
    clock: options.clock,
    onGap: ({ token, source, gapBps }) =>
      logger.warn("watcher.price_gap", { assetId: token, sourceId: source, gapBps }),
    onSourceFailed: (source, errorCode) =>
      logger.warn("watcher.cross_check_failed", { sourceId: source, errorCode }),
  });
}

function checkLag(options: PriceWatchersOptions, alerts: WatcherLagAlerts): void {
  const atMs = options.clock.now();
  for (const [chain, watch] of options.watches) {
    if (watch.isRunning()) {
      const chainName = watch.chain.definition.name;
      alerts.check({ chain, chainName, lagBlocks: watch.watcher.lag().lagBlocks, atMs });
    } else {
      alerts.forget(chain);
    }
  }
}

function healthOf(
  alerts: WatcherLagAlerts,
  check: PriceCrossCheck | undefined,
  watches: ReadonlyMap<ChainRef, ChainWatch>,
): HealthSignal {
  const lag = alerts.health();
  const watched = [...watches.values()].flatMap((watch) =>
    watch.latest().map(({ token }) => token),
  );
  const hasGap = check !== undefined && watched.some((token) => check.hasGap(token));
  if (lag === undefined) {
    return { signal: "watcher", state: hasGap ? "warn" : "ok" };
  }
  const state = lag.state === "ok" && hasGap ? "warn" : lag.state;
  const lagBlocks = Number(lag.lagBlocks > maxShownLag ? maxShownLag : lag.lagBlocks);
  return {
    signal: "watcher",
    state,
    ...(state === "ok" || lag.since === undefined ? {} : { since: lag.since }),
    lagBlocks,
  };
}

/**
 * The price watchers' part of the engine (decisions 0192 and 0193). It watches the token of each
 * active auto order with a price trigger, synced with the order store every 5 seconds; reads each
 * running watcher's lag every second into the `watcher` health signal and `notice.watcherLag`; and
 * cross-checks the watchers' USD prices with DEX Screener and GeckoTerminal on their own schedule,
 * logging `watcher.price_gap` for a price 10% or more away from a source's.
 */
export function composePriceWatchers(options: PriceWatchersOptions): ComposedPriceWatchers {
  const alerts = createWatcherLagAlerts({ publish: options.publish });
  const decimals = decimalsBookOf(options.decimals);
  const orders: WatchedOrders = createWatchedOrders(options);
  const parts: { check?: PriceCrossCheck } = {};
  return {
    health: () => healthOf(alerts, parts.check, options.watches),
    activeOrders: () => orders.activeOrders(),
    start(closers, logger) {
      const { clock } = options;
      const check = crossCheckOf(options, decimals, logger);
      parts.check = check;
      // Added before the timers, so the shutdown stops the timers first, then the watchers.
      closers.add("price_watchers", async () => {
        orders.releaseAll();
        await Promise.all([...options.watches.values()].map(async (watch) => watch.close()));
      });
      const syncs = { nextAtMs: 0 };
      startRepeatingTimer({
        name: "watchers",
        everyMs: lagEveryMs,
        failedEvent: "engine.watcher_sync_failed",
        isLocked: () => false,
        clock,
        closers,
        logger,
        run: async ({ signal }) => {
          checkLag(options, alerts);
          if (clock.now() >= syncs.nextAtMs) {
            syncs.nextAtMs = clock.now() + syncEveryMs;
            await orders.sync({ signal });
          }
        },
      });
      startCrossCheck({ options, decimals, check }, { closers, logger });
    },
  };
}

// Each round of the cross-check reads the decimals it lacks, then asks the sources whose time came.
function startCrossCheck(
  parts: {
    readonly options: PriceWatchersOptions;
    readonly decimals: DecimalsBook;
    readonly check: PriceCrossCheck;
  },
  runOn: { readonly closers: Closers; readonly logger: Logger },
): void {
  const { options, decimals, check } = parts;
  const { clock } = options;
  startRepeatingTimer({
    name: "cross_check",
    everyMs: crossCheckEveryMs,
    failedEvent: "watcher.cross_check_failed",
    isLocked: () => false,
    clock,
    ...runOn,
    run: async ({ signal }) => {
      const deadline = createDeadline({ clock, signal, timeoutMs: crossCheckTimeoutMs });
      try {
        await decimals.read(samplesTokens(options.watches), deadline.signal);
        await check.tick({ signal: deadline.signal });
      } finally {
        deadline.clear();
      }
    },
  });
}

function samplesTokens(watches: ReadonlyMap<ChainRef, ChainWatch>): readonly AssetRef[] {
  return [...watches.values()].flatMap((watch) => watch.latest().map(({ token }) => token));
}
