import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { DowntimeRun } from "@binference/engine/orders";
import type { Closers } from "./closers.js";

/** What the downtime timer tells, and what it runs on. */
export interface DowntimeTimerOptions {
  readonly downtime: Engine["downtime"];
  /** Told of each sleep before the engine is: the price hand-off drops what the sleep left. */
  readonly onSleep: (asleepMs: number) => void;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// The timer sleeps 5 seconds at a time. A sleeping machine stops the timer, never the wall clock,
// so a tick that finds the wall clock moved more than a minute past its sleep was a sleep of the
// machine (decisions 0266 and 0269). The engine is marked alive each minute.
const tickMs = 5_000;
const sleepJumpMs = 60_000;
const aliveEveryMs = 60_000;
// The mark the engine leaves as it stops gives up past this.
const lastMarkMs = 5_000;

// Runs one step of the timer; a failure is logged, and one the shutdown cut off is not.
async function logged(
  options: DowntimeTimerOptions,
  step: { readonly stop: AbortSignal; readonly run: () => Promise<void> },
): Promise<void> {
  try {
    await step.run();
  } catch (error) {
    if (!step.stop.aborted) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      options.logger.warn("engine.downtime_failed", { errorCode });
    }
  }
}

// Waits for a re-check's report, on its own, and logs it.
function follow(
  options: DowntimeTimerOptions,
  run: { readonly stop: AbortSignal; readonly started: DowntimeRun | undefined },
): void {
  const { started, stop } = run;
  if (started !== undefined) {
    void logged(options, {
      stop,
      run: async () => {
        await started.reported;
        options.logger.info("engine.downtime_reported");
      },
    });
  }
}

/**
 * Starts the downtime re-check at the engine's start (decision 0266): a start after a stop
 * re-checks every auto order and reports once, so it runs before any price reaches the triggers,
 * and resolves once the orders to check are read. Then it ticks every 5 seconds while the engine
 * serves: a wall clock that jumped more than a minute past a tick is a sleep of the machine,
 * re-checked the same way, and the engine is marked alive each minute and once more as it stops.
 * A re-check whose report fails is logged as `engine.downtime_failed`.
 */
export async function startDowntimeTimer(options: DowntimeTimerOptions): Promise<void> {
  const stopping = new AbortController();
  const stop = stopping.signal;
  const { clock, downtime } = options;
  follow(options, { stop, started: await downtime.started({ signal: stop }) });
  const kept = { aliveAtMs: clock.now() };
  const tick = async (): Promise<void> => {
    const beforeMs = clock.now();
    await clock.sleep(tickMs, stop).catch(() => undefined);
    const nowMs = clock.now();
    if (!stop.aborted && nowMs - beforeMs > tickMs + sleepJumpMs) {
      options.onSleep(nowMs - beforeMs);
      options.logger.info("engine.woke", { durationMs: nowMs - beforeMs });
      follow(options, { stop, started: await downtime.woke(beforeMs, { signal: stop }) });
    }
    if (!stop.aborted && nowMs - kept.aliveAtMs >= aliveEveryMs) {
      kept.aliveAtMs = nowMs;
      await downtime.alive({ signal: stop });
    }
  };
  const ticks = async (): Promise<void> => {
    while (!stop.aborted) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one tick after the other
      await logged(options, { stop, run: tick });
    }
  };
  const running = ticks();
  options.closers.add("downtime", async () => {
    stopping.abort();
    await running;
    const last = AbortSignal.timeout(lastMarkMs);
    await logged(options, { stop: last, run: async () => downtime.alive({ signal: last }) });
  });
}
