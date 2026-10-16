import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startScheduleTimer } from "./schedule-timer.js";

const everyMs = 10_000;

describe("the schedule timer", () => {
  it("runs the schedules every 10 seconds while unlocked, and stops with its closer", async () => {
    const clock = createManualClock(0);
    const closers = createClosers();
    const lock = { locked: true };
    const runs: number[] = [];
    startScheduleTimer({
      runSchedules: async () => {
        runs.push(clock.now());
        return Promise.resolve();
      },
      isLocked: () => lock.locked,
      clock,
      closers,
      logger: createMemoryLogger({ subsystem: "engine" }),
    });
    await clock.advance(everyMs);
    lock.locked = false;
    await clock.advance(everyMs);
    await clock.advance(everyMs);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(everyMs);

    expect(runs).toStrictEqual([2 * everyMs, 3 * everyMs]);
  });
});
