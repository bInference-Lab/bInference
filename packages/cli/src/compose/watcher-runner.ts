import type { RegisteredChain } from "@binference/chain";
import type { PriceWatcher } from "@binference/chain-evm";
import { BinferenceError, type Clock, type Logger } from "@binference/core";

/** Runs a chain's watcher while it is wanted, restarting it after a fault. */
export interface WatcherRunner {
  /** Starts the watcher unless it runs or waits to restart. */
  ensure(): void;
  /** Stops it, and any restart it waits for, and waits for its reads to end. */
  stop(): Promise<void>;
  isRunning(): boolean;
  /**
   * Since when the watcher is down after a fault: from its first fault until a restart has run
   * 30 seconds. Undefined while it is up, or stopped because nothing is watched.
   */
  downSinceMs(): number | undefined;
}

/** What a runner runs, and how it hears whether a token is still watched. */
export interface WatcherRunnerOptions {
  readonly chain: RegisteredChain;
  readonly watcher: Pick<PriceWatcher, "run">;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Whether a token is watched, so the watcher should run. */
  readonly isWanted: () => boolean;
}

interface Running {
  readonly stop: AbortController;
  readonly done: Promise<void>;
  readonly startedAtMs: number;
}

// A watcher stopped by a fault restarts after a second, the wait doubling up to 30 seconds, and
// counts as up again once a run has lasted 30 seconds (decision 0194).
const firstBackoffMs = 1_000;
const maxBackoffMs = 30_000;
const upAfterMs = 30_000;

/** What a runner keeps between runs. */
interface RunnerState {
  running(): Running | undefined;
  setRunning(running: Running | undefined): void;
  restart(): AbortController | undefined;
  setRestart(restart: AbortController | undefined): void;
  downSinceMs(): number | undefined;
  markDown(atMs: number): void;
  /** Counts the watcher up again, with the shortest wait for its next fault. */
  markUp(): void;
  /** The wait before the next restart; each one doubles the next, up to the longest. */
  nextBackoffMs(): number;
}

function createRunnerState(): RunnerState {
  let running: Running | undefined;
  let restart: AbortController | undefined;
  let downSinceMs: number | undefined;
  let backoffMs = firstBackoffMs;
  return {
    running: () => running,
    setRunning: (next) => {
      running = next;
    },
    restart: () => restart,
    setRestart: (next) => {
      restart = next;
    },
    downSinceMs: () => downSinceMs,
    markDown: (atMs) => {
      downSinceMs ??= atMs;
    },
    markUp: () => {
      downSinceMs = undefined;
      backoffMs = firstBackoffMs;
    },
    nextBackoffMs: () => {
      const delayMs = backoffMs;
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
      return delayMs;
    },
  };
}

// Waits out the backoff, then starts the watcher again while a token is watched.
async function restartLater(
  state: RunnerState,
  options: WatcherRunnerOptions,
  start: () => void,
): Promise<void> {
  const wait = new AbortController();
  state.setRestart(wait);
  try {
    await options.clock.sleep(state.nextBackoffMs(), wait.signal);
  } catch {
    return;
  }
  state.setRestart(undefined);
  if (options.isWanted()) {
    start();
  }
}

function startRun(state: RunnerState, options: WatcherRunnerOptions): void {
  const { watcher, logger, chain, clock } = options;
  const stop = new AbortController();
  const runUntilStopped = async (): Promise<void> => {
    try {
      await watcher.run(stop.signal);
    } catch (error) {
      if (!stop.signal.aborted) {
        const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
        logger.error("engine.watcher_stopped", { chain: chain.ref, errorCode });
        state.setRunning(undefined);
        state.markDown(clock.now());
        void restartLater(state, options, () => startRun(state, options));
      }
    }
  };
  state.setRunning({ stop, done: runUntilStopped(), startedAtMs: clock.now() });
}

/**
 * Creates the runner of one chain's watcher. A fault of the watcher's own is logged as
 * `engine.watcher_stopped` with its code, and the watcher restarts after its wait while a token is
 * watched.
 */
export function createWatcherRunner(options: WatcherRunnerOptions): WatcherRunner {
  const state = createRunnerState();
  return {
    ensure() {
      if (state.running() === undefined && state.restart() === undefined) {
        startRun(state, options);
      }
    },
    async stop() {
      state.restart()?.abort();
      const current = state.running();
      state.setRestart(undefined);
      state.setRunning(undefined);
      state.markUp();
      current?.stop.abort();
      await current?.done;
    },
    isRunning: () => state.running() !== undefined,
    downSinceMs() {
      const running = state.running();
      if (running !== undefined && options.clock.now() - running.startedAtMs >= upAfterMs) {
        state.markUp();
      }
      return state.downSinceMs();
    },
  };
}
