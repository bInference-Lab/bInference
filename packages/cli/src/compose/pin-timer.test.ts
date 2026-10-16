import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startPinTimer } from "./pin-timer.js";

const everyMs = 3_000;

function timerWith(options: { readonly fails?: boolean } = {}) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const checks: number[] = [];
  startPinTimer({
    checkPins: async () => {
      checks.push(clock.now());
      return options.fails === true
        ? Promise.reject(new BinferenceError({ code: "store.busy", message: "Busy." }))
        : Promise.resolve(0);
    },
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, checks };
}

describe("the pin timer", () => {
  it("checks every 3 seconds while the engine serves, and stops with its closer", async () => {
    const { clock, closers, checks } = timerWith();
    await clock.advance(everyMs);
    await clock.advance(everyMs);
    expect(checks).toStrictEqual([everyMs, 2 * everyMs]);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(everyMs);
    expect(checks).toHaveLength(2);
  });

  it("logs a check that fails, and tries again 3 seconds later", async () => {
    const { clock, closers, logger, checks } = timerWith({ fails: true });
    await clock.advance(everyMs);
    await clock.advance(everyMs);
    expect(checks).toHaveLength(2);
    expect(logger.records().map(({ event }) => event)).toContain("engine.pin_check_failed");
    await closers.closeAll(new AbortController().signal);
  });
});
