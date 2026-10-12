import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { Closers } from "./closers.js";

/** What the card timer runs, and what it runs on. */
export interface CardTimerOptions {
  /** The engine's card timer: it expires the due cards and answers the next card's time. */
  readonly expireCards: Engine["expireCards"];
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// A card opened since the last run is seen within this time, and is then waited for to the
// millisecond: every card lasts 60 seconds or more. A failed run is tried again after it too.
const lookEveryMs = 5_000;

// A card the last run could not close yet, because another write moved its intent, is tried
// again this much later rather than at once.
const soonestMs = 100;

async function runOnce(options: CardTimerOptions, stop: AbortSignal): Promise<number> {
  try {
    const next = await options.expireCards({ signal: stop });
    const untilNext = next === undefined ? lookEveryMs : next - options.clock.now();
    return Math.min(lookEveryMs, Math.max(soonestMs, untilNext));
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("engine.card_timer_failed", { errorCode });
    return lookEveryMs;
  }
}

// One run, then one wait; the next run starts after it, and nothing waits on it, so the runs never
// chain up however long the engine serves.
async function runThenWait(
  options: CardTimerOptions,
  run: { readonly stop: AbortSignal; readonly next: () => void },
): Promise<void> {
  const { stop } = run;
  const waitMs = await runOnce(options, stop);
  await options.clock.sleep(waitMs, stop).catch(() => undefined);
  if (!stop.aborted) {
    run.next();
  }
}

/**
 * Runs the engine's card timer while it serves, locked or not: it signs nothing. It runs at once,
 * which expires every card whose time ran out while the engine was stopped, then again when the
 * next card's time is up, and at least every 5 seconds to see new cards. A failure is logged as
 * `engine.card_timer_failed` and tried again 5 seconds later. Its closer stops it.
 */
export function startCardTimer(options: CardTimerOptions): void {
  const stop = new AbortController();
  const timer = { running: Promise.resolve() };
  const next = (): void => {
    timer.running = runThenWait(options, { stop: stop.signal, next });
  };
  next();
  options.closers.add("card timer", async () => {
    stop.abort();
    await timer.running;
  });
}
