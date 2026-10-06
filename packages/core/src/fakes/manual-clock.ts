import { BinferenceError } from "../errors/binference-error.js";
import type { Clock } from "../ports.js";

/** A clock for tests: time moves only when the test advances it. */
export interface ManualClock extends Clock {
  /**
   * Moves time forward, waking each sleeper due by then in order of its due time. Between
   * wake-ups it lets the woken code run, so a retry or a timer chain behaves as on a real clock.
   */
  readonly advance: (delayMs: number) => Promise<void>;
}

interface Sleeper {
  readonly dueAt: number;
  readonly order: number;
  readonly wake: () => void;
}

const maxSleepers = 10_000;
// Enough microtask turns for any await chain a woken sleeper starts before it sleeps again.
const settleTurns = 50;

async function settle(turns: number): Promise<void> {
  if (turns > 0) {
    await Promise.resolve();
    await settle(turns - 1);
  }
}

/** Creates a {@link ManualClock} that starts at `startMs` epoch milliseconds. */
export function createManualClock(startMs = 0): ManualClock {
  let now = startMs;
  let order = 0;
  const sleepers = new Set<Sleeper>();

  const nextDue = (until: number): Sleeper | undefined =>
    [...sleepers]
      .filter((sleeper) => sleeper.dueAt <= until)
      .toSorted((left, right) => left.dueAt - right.dueAt || left.order - right.order)[0];

  const wakeUntil = async (until: number): Promise<void> => {
    await settle(settleTurns);
    const sleeper = nextDue(until);
    if (sleeper === undefined) {
      now = Math.max(now, until);
      return;
    }
    now = Math.max(now, sleeper.dueAt);
    sleepers.delete(sleeper);
    sleeper.wake();
    await wakeUntil(until);
  };

  return {
    now: () => now,
    sleep(delayMs: number, signal: AbortSignal): Promise<void> {
      if (sleepers.size >= maxSleepers) {
        throw new BinferenceError({
          code: "core.too_many_sleepers",
          message: `A manual clock holds at most ${String(maxSleepers)} sleepers.`,
        });
      }
      return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const onAbort = (): void => {
          sleepers.delete(sleeper);
          reject(signal.reason);
        };
        const sleeper: Sleeper = {
          dueAt: now + Math.max(0, delayMs),
          order: order++,
          wake: () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        signal.addEventListener("abort", onAbort, { once: true });
        sleepers.add(sleeper);
      });
    },
    advance: async (delayMs: number): Promise<void> => wakeUntil(now + delayMs),
  };
}
