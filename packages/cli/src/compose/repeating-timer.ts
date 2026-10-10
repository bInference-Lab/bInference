import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Closers } from "./closers.js";

/** What a repeating timer runs, how often, and what it runs on. */
export interface RepeatingTimerOptions {
  /** The name its closer takes, such as `settle`. */
  readonly name: string;
  /** The work of each run; a locked engine skips it. */
  readonly run: (call: { readonly signal: AbortSignal }) => Promise<void>;
  readonly everyMs: number;
  /** The log event of a run that failed, with its code, such as `engine.settle_failed`. */
  readonly failedEvent: string;
  readonly isLocked: () => boolean;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// One wait, then one run. The next run starts when this one ends, and nothing waits on it, so the
// runs never chain up however long the engine serves.
async function runOnce(
  options: RepeatingTimerOptions,
  run: { readonly stop: AbortSignal; readonly next: () => void },
): Promise<void> {
  const { stop } = run;
  await options.clock.sleep(options.everyMs, stop).catch(() => undefined);
  if (stop.aborted) {
    return;
  }
  try {
    if (!options.isLocked()) {
      await options.run({ signal: stop });
    }
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn(options.failedEvent, { errorCode });
  }
  if (!stop.aborted) {
    run.next();
  }
}

/**
 * Runs the work every `everyMs` while the engine serves, in the startup order's place for orders
 * and watchers. A locked engine skips a run; a run that fails is logged and the next one comes
 * at its time. Its closer stops it and waits for a run under way.
 */
export function startRepeatingTimer(options: RepeatingTimerOptions): void {
  const stop = new AbortController();
  const timer = { running: Promise.resolve() };
  const next = (): void => {
    timer.running = runOnce(options, { stop: stop.signal, next });
  };
  next();
  options.closers.add(options.name, async () => {
    stop.abort();
    await timer.running;
  });
}
