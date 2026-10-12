import type { AssetRef, RegisteredChain } from "@binference/chain";
import type { PriceWatcher, WatchedPrice } from "@binference/chain-evm";
import { BinferenceError, type Logger } from "@binference/core";

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
  /** The latest price of each watched token the watcher read. */
  latest(): readonly WatchedPrice[];
  /** Stops the watcher and waits for its reads to end. */
  close(): Promise<void>;
}

interface Running {
  readonly stop: AbortController;
  readonly done: Promise<void>;
}

/** Runs a watcher until stopped, and says whether it runs. */
interface WatcherRunner {
  /** Starts the watcher unless it runs. */
  ensure(): void;
  /** Stops it and waits for its reads to end. */
  stop(): Promise<void>;
  isRunning(): boolean;
}

function runnerOf(options: ChainWatchOptions): WatcherRunner {
  const { watcher, logger, chain } = options;
  let running: Running | undefined;
  const runUntilStopped = async (stop: AbortController): Promise<void> => {
    try {
      await watcher.run(stop.signal);
    } catch (error) {
      if (!stop.signal.aborted) {
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        logger.error("engine.watcher_stopped", { chain: chain.ref, errorCode });
        running = undefined;
      }
    }
  };
  return {
    ensure() {
      if (running === undefined) {
        const stop = new AbortController();
        running = { stop, done: runUntilStopped(stop) };
      }
    },
    async stop() {
      const current = running;
      running = undefined;
      current?.stop.abort();
      await current?.done;
    },
    isRunning: () => running !== undefined,
  };
}

/** What a chain watch wraps. */
interface ChainWatchOptions {
  readonly chain: RegisteredChain;
  readonly watcher: PriceWatcher;
  readonly logger: Logger;
}

/**
 * Wraps one chain's price watcher. A watcher that stops for a fault of its own is logged as
 * `engine.watcher_stopped` with its code and runs again at the next watch.
 */
export function createChainWatch(options: ChainWatchOptions): ChainWatch {
  const { watcher, chain } = options;
  const runner = runnerOf(options);
  const watched = new Map<AssetRef, number>();
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
    latest: () => [...latest.values()],
    close: async () => runner.stop(),
  };
}
