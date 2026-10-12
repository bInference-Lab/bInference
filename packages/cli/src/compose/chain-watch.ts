import type { AssetRef, RegisteredChain } from "@binference/chain";
import type { PriceWatcher, WatchedPrice } from "@binference/chain-evm";
import type { Clock, Logger } from "@binference/core";
import { createWatcherRunner } from "./watcher-runner.js";

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
  /** The latest price of each watched token the watcher read. */
  latest(): readonly WatchedPrice[];
  /** Stops the watcher and waits for its reads to end. */
  close(): Promise<void>;
}

/** What a chain watch wraps. */
interface ChainWatchOptions {
  readonly chain: RegisteredChain;
  readonly watcher: PriceWatcher;
  readonly clock: Clock;
  readonly logger: Logger;
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
  const latest = new Map<AssetRef, WatchedPrice>();
  watcher.onPrice((price) => {
    if (watched.has(price.token)) {
      latest.set(price.token, price);
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
    latest: () => [...latest.values()],
    close: async () => runner.stop(),
  };
}
