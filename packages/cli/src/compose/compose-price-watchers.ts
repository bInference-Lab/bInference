import {
  type AssetRef,
  assetRefParts,
  type ChainRef,
  type MarketDataSource,
} from "@binference/chain";
import { type Clock, createDeadline, type Logger } from "@binference/core";
import type { EnginePush } from "@binference/engine";
import {
  createPriceCrossCheck,
  createWatcherLagAlerts,
  createWatcherUnpricedAlerts,
  type PriceCheck,
  type PriceCrossCheck,
  type PriceSample,
} from "@binference/engine/market";
import type { OrderStore } from "@binference/engine/orders";
import type { ChainWatch, LatestPrice } from "./chain-watch.js";
import type { Closers } from "./closers.js";
import { type DecimalsBook, decimalsBookOf } from "./decimals-book.js";
import type { HealthSignal } from "./health-signals.js";
import { isConfirmed, isUrgent } from "./price-confirmation.js";
import { startRepeatingTimer } from "./repeating-timer.js";
import type { ReadDecimals } from "./token-decimals.js";
import { createWatchedOrders, type WatchedOrders } from "./watched-orders.js";
import { checkWatchers, type WatcherChecks, watcherHealthOf } from "./watcher-health.js";

/** The price watchers as the engine serves them: their health, and their timers to start. */
export interface ComposedPriceWatchers {
  /** The `watcher` health signal, with its lag in blocks while a watcher reads. */
  readonly health: () => HealthSignal;
  /**
   * The latest price of each watched token a trigger may use now: a curve's as read, a pool's once
   * the cross-check proved it (decision 0194).
   */
  readonly confirmedPrices: () => readonly LatestPrice[];
  /**
   * Whether a chain's watcher can price a token now; a token of a chain with no watcher it cannot.
   * Rejects with the signal's reason once it aborts.
   */
  readonly canPrice: (token: AssetRef, call: { readonly signal: AbortSignal }) => Promise<boolean>;
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

function latestOf(watches: ReadonlyMap<ChainRef, ChainWatch>): readonly LatestPrice[] {
  return [...watches.values()].flatMap((watch) => watch.latest());
}

// The watchers' prices in USD, those from a pool not yet proven or thin checked first.
function samplesOf(
  options: PriceWatchersOptions,
  decimals: DecimalsBook,
  checks: () => readonly PriceCheck[],
): readonly PriceSample[] {
  const nowMs = options.clock.now();
  const known = checks();
  return latestOf(options.watches).flatMap((price) => {
    const { token, usdPrice, plan } = price;
    const tokenDecimals = decimals.known.get(token);
    const isUrgentNow = isUrgent(price, known, nowMs);
    return usdPrice === undefined || tokenDecimals === undefined
      ? []
      : [{ token, usdPrice, decimals: tokenDecimals, plan, isUrgent: isUrgentNow }];
  });
}

function crossCheckOf(
  options: PriceWatchersOptions,
  decimals: DecimalsBook,
  logger: Logger,
): PriceCrossCheck {
  const { dexscreener, geckoterminal } = options.sources;
  const made: { check?: PriceCrossCheck } = {};
  made.check = createPriceCrossCheck({
    sources: [
      { source: dexscreener, everyMs: 60_000, maxTokens: 90 },
      { source: geckoterminal, everyMs: 300_000, maxTokens: 30 },
    ],
    samples: () => samplesOf(options, decimals, () => made.check?.checks() ?? []),
    watched: () =>
      [...options.watches.values()].flatMap((watch) =>
        watch.watcher.tokens().map(({ token }) => token),
      ),
    gapLimitBps,
    clock: options.clock,
    onGap: ({ token, source, gapBps }) =>
      logger.warn("watcher.price_gap", { assetId: token, sourceId: source, gapBps }),
    onSourceFailed: (source, errorCode) =>
      logger.warn("watcher.cross_check_failed", { sourceId: source, errorCode }),
  });
  return made.check;
}

/**
 * The price watchers' part of the engine (decisions 0192 to 0194). It watches the token of each
 * active auto order with a price trigger, synced with the order store every 5 seconds; reads each
 * running watcher's lag and its tokens without a confirmed price every second into the `watcher`
 * health signal, `notice.watcherLag` and `notice.watcherUnpriced`; and
 * cross-checks the watchers' USD prices with DEX Screener and GeckoTerminal on their own schedule,
 * logging `watcher.price_gap` for a price 10% or more away from a source's.
 */
export function composePriceWatchers(options: PriceWatchersOptions): ComposedPriceWatchers {
  const decimals = decimalsBookOf(options.decimals, options.clock);
  const orders: WatchedOrders = createWatchedOrders(options);
  const parts: { check?: PriceCrossCheck } = {};
  const watching: WatcherChecks = {
    lag: createWatcherLagAlerts({ publish: options.publish }),
    unpriced: createWatcherUnpricedAlerts({ publish: options.publish }),
    unpricedSince: new Map(),
    checks: () => parts.check?.checks() ?? [],
  };
  return {
    health: () => watcherHealthOf(watching, parts.check, options.watches),
    confirmedPrices: () => {
      const checks = parts.check?.checks() ?? [];
      const nowMs = options.clock.now();
      return latestOf(options.watches).filter((price) => isConfirmed(price, checks, nowMs));
    },
    canPrice: async (token, { signal }) =>
      (await options.watches.get(assetRefParts(token).chain)?.canPrice(token, signal)) ?? false,
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
          checkWatchers(options.watches, watching, clock.now());
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
