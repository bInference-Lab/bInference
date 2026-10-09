import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";

/** What the timer runs, and what it runs on. */
export interface SettleTimerOptions {
  /** The engine's settle, which sends a change once its time has come. */
  readonly settle: Engine["settle"];
  /** Custody sends the change, so a locked engine waits for its keys. */
  readonly isLocked: () => boolean;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A rescue address's ceiling change is due 24 hours after the owner made it; a minute late is
// nothing next to that, and a read of the install each minute costs nothing.
const settleEveryMs = 60_000;

// One minute's wait, then one settle. The next run starts when this one ends, and nothing waits on
// it, so the runs never chain up however long the engine serves.
async function settleOnce(
  options: SettleTimerOptions,
  run: { readonly stop: AbortSignal; readonly next: () => void },
): Promise<void> {
  const { stop } = run;
  await options.clock.sleep(settleEveryMs, stop).catch(() => undefined);
  if (stop.aborted) {
    return;
  }
  try {
    if (!options.isLocked()) {
      await options.settle({ signal: stop });
    }
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("engine.settle_failed", { errorCode });
  }
  if (!stop.aborted) {
    run.next();
  }
}

/**
 * Runs the engine's settle every minute while it serves, in the startup order's place for orders
 * and watchers, so a change that waited for its time goes out once it is due (decision 0110). A
 * locked engine skips it; a failure is logged and tried again a minute later. Its closer stops it.
 */
export function startSettleTimer(options: SettleTimerOptions): void {
  const stop = new AbortController();
  const timer = { running: Promise.resolve() };
  const next = (): void => {
    timer.running = settleOnce(options, { stop: stop.signal, next });
  };
  next();
  options.closers.add("settle", async () => {
    stop.abort();
    await timer.running;
  });
}
