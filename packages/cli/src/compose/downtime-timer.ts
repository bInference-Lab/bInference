import { BinferenceError, type Clock, type Logger } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { DowntimeRun, Pause } from "@binference/engine/orders";
import type { Closers } from "./closers.js";

/** What the downtime timer tells, and what it runs on. */
export interface DowntimeTimerOptions {
  readonly downtime: Engine["downtime"];
  /** Told of each pause before the engine is: the price hand-off drops what the pause left. */
  readonly onPause: (offMs: number) => void;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

/** The running downtime timer: its check for a pause, which the price hand-off asks too. */
export interface PauseCheck {
  /**
   * Finds a pause now, at once: the wall clock more than a minute past the timer's sleep, as after
   * a sleep of the machine, or set back. A found pause fences the engine off what came before it
   * before this returns true; the caller drops what it holds.
   */
  readonly check: () => boolean;
}

// The timer sleeps 5 seconds at a time. A sleeping machine stops the timer, never the wall clock,
// so a wall clock more than a minute past the timer's sleep is a pause of the engine (decisions
// 0266 and 0269), whoever looks first: the next tick, or the next price. The engine is marked
// alive each minute.
const tickMs = 5_000;
const sleepJumpMs = 60_000;
// A wall clock set back further than this is a pause too.
const stepBackMs = 1_000;
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
  run: { readonly stop: AbortSignal; readonly started: Promise<DowntimeRun | undefined> },
): void {
  const { started, stop } = run;
  void logged(options, {
    stop,
    run: async () => {
      const report = await (await started)?.reported;
      if (report !== undefined) {
        options.logger.info("engine.downtime_reported");
      }
    },
  });
}

/** Where the timer stands: when its current sleep began, and the latest wall time it saw. */
interface TimerTimes {
  sleepFromMs: number;
  seenMs: number;
  aliveAtMs: number;
}

// The pause the wall clock shows now, if any.
function pauseAt(times: TimerTimes, nowMs: number): Pause | undefined {
  const awakeMs = nowMs - times.sleepFromMs;
  if (awakeMs > tickMs + sleepJumpMs) {
    return { cause: "wake", fromMs: times.sleepFromMs + tickMs, offMs: awakeMs - tickMs };
  }
  return nowMs < times.seenMs - stepBackMs
    ? { cause: "clock", fromMs: times.seenMs, offMs: times.seenMs - nowMs }
    : undefined;
}

/**
 * Starts the downtime re-check at the engine's start (decision 0266): a start after a stop
 * re-checks every auto order and reports once, so it runs before any price reaches the triggers,
 * and resolves once the orders to check are read. Then it ticks every 5 seconds while the engine
 * serves: a wall clock more than a minute past the timer's sleep, or set back, is a pause of the
 * engine, found by the tick, the price hand-off or the engine's fence, whichever looks first, and
 * re-checked the same way. The engine is marked alive each minute and once more as it stops. A
 * re-check whose report fails is logged as `engine.downtime_failed`.
 */
export async function startDowntimeTimer(options: DowntimeTimerOptions): Promise<PauseCheck> {
  const stopping = new AbortController();
  const stop = stopping.signal;
  const { clock, downtime, logger } = options;
  const started = await downtime.started({ signal: stop });
  follow(options, { stop, started: Promise.resolve(started) });
  const startMs = clock.now();
  const times: TimerTimes = { sleepFromMs: startMs, seenMs: startMs, aliveAtMs: startMs };
  const check = (): boolean => {
    const nowMs = clock.now();
    const pause = stop.aborted ? undefined : pauseAt(times, nowMs);
    times.seenMs = pause === undefined ? Math.max(times.seenMs, nowMs) : nowMs;
    if (pause === undefined) {
      return false;
    }
    Object.assign(times, { sleepFromMs: nowMs, aliveAtMs: nowMs });
    options.onPause(pause.offMs);
    logger.info(pause.cause === "wake" ? "engine.woke" : "engine.clock_back", {
      durationMs: pause.offMs,
    });
    // The re-check fences the engine off before its first await, so before this returns.
    follow(options, { stop, started: downtime.paused(pause, { signal: stop }) });
    return true;
  };
  downtime.findPausesWith(check);
  const tick = async (): Promise<void> => {
    times.sleepFromMs = clock.now();
    await clock.sleep(tickMs, stop).catch(() => undefined);
    check();
    const nowMs = clock.now();
    if (!stop.aborted && nowMs - times.aliveAtMs >= aliveEveryMs) {
      times.aliveAtMs = nowMs;
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
  return { check };
}
