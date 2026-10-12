import type { AssetRef, RegisteredChain } from "@binference/chain";
import type { PlanPrices, PriceWatcher, WatchedPrice } from "@binference/chain-evm";
import type { Clock, Logger } from "@binference/core";
import { createWatcherRunner } from "./watcher-runner.js";

/** A watched token's latest price, and since when the plan that priced it has priced it. */
export interface LatestPrice extends WatchedPrice {
  /** When the first price of this plan in a row came, by the watcher's clock. */
  readonly planSinceMs: number;
}

/** One chain's price watcher, run while it watches a token, with its latest price of each. */
export interface ChainWatch {
  readonly chain: RegisteredChain;
  readonly watcher: PriceWatcher;
  /**
   * Watches a token and runs the watcher while any token is watched. The release it answers ends
   * this one watch; the last release stops the watcher, so a chain with no auto order costs no
   * request.
   */
  watch(token: AssetRef): () => void;
  /** Whether the watcher runs now. */
  isRunning(): boolean;
  /** Since when the watcher is down after a fault, until a restart has run 30 seconds. */
  downSinceMs(): number | undefined;
  /**
   * The latest price of each watched token the watcher prices now, by the plan that prices it: a
   * token that went unpriced, or whose plan changed since, has none.
   */
  latest(): readonly LatestPrice[];
  /**
   * Whether the watcher can price a token now: it prices it already, or a venue's read or a pool
   * deep enough would. Rejects with the signal's reason once it aborts.
   */
  canPrice(token: AssetRef, signal: AbortSignal): Promise<boolean>;
  /** Stops the watcher and waits for its reads to end. */
  close(): Promise<void>;
}

/** What a chain watch wraps. */
interface ChainWatchOptions {
  readonly chain: RegisteredChain;
  readonly watcher: PriceWatcher;
  /** How the watcher finds a token's price read. */
  readonly planPrices: PlanPrices;
  readonly clock: Clock;
  readonly logger: Logger;
}

// A token the watcher prices now, or one a plan would price.
function canPriceWith(watcher: PriceWatcher, planPrices: PlanPrices): ChainWatch["canPrice"] {
  return async (token, signal) => {
    const isPriced = watcher
      .tokens()
      .some((each) => each.token === token && each.state === "priced");
    return isPriced || (await planPrices(token, signal)).ok;
  };
}

// The latest prices the watcher's current plans read.
function currentOf(
  watcher: PriceWatcher,
  latest: ReadonlyMap<AssetRef, LatestPrice>,
): readonly LatestPrice[] {
  const pricing = new Map(
    watcher
      .tokens()
      .flatMap(({ token, state, plan }) =>
        state === "priced" && plan !== undefined ? [[token, plan] as const] : [],
      ),
  );
  return [...latest.values()].filter(({ token, plan }) => pricing.get(token) === plan);
}

/**
 * Wraps one chain's price watcher. A watcher that stops for a fault of its own is logged as
 * `engine.watcher_stopped` with its code and restarts after 1 s, the wait doubling up to 30 s,
 * while a token is watched; it counts as down until a restart has run 30 seconds.
 */
export function createChainWatch(options: ChainWatchOptions): ChainWatch {
  const { watcher, chain } = options;
  const watched = new Map<AssetRef, number>();
  const runner = createWatcherRunner({ ...options, isWanted: () => watched.size > 0 });
  const latest = new Map<AssetRef, LatestPrice>();
  watcher.onPrice((price) => {
    if (watched.has(price.token)) {
      const before = latest.get(price.token);
      const planSinceMs = before?.plan === price.plan ? before.planSinceMs : price.atMs;
      latest.set(price.token, { ...price, planSinceMs });
    }
  });
  const release = (token: AssetRef): void => {
    const count = (watched.get(token) ?? 1) - 1;
    if (count > 0) {
      watched.set(token, count);
      return;
    }
    watched.delete(token);
    latest.delete(token);
    if (watched.size === 0) {
      void runner.stop();
    }
  };
  return {
    chain,
    watcher,
    watch(token) {
      const unwatch = watcher.watch(token);
      watched.set(token, (watched.get(token) ?? 0) + 1);
      runner.ensure();
      const watch = { isReleased: false };
      return () => {
        if (!watch.isReleased) {
          watch.isReleased = true;
          unwatch();
          release(token);
        }
      };
    },
    isRunning: () => runner.isRunning(),
    downSinceMs: () => runner.downSinceMs(),
    latest: () => currentOf(watcher, latest),
    canPrice: canPriceWith(watcher, options.planPrices),
    close: async () => runner.stop(),
  };
}
