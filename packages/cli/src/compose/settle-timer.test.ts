import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startSettleTimer } from "./settle-timer.js";

const minuteMs = 60_000;

function timerWith(options: { readonly isLocked?: boolean; readonly fails?: boolean } = {}) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const settled: number[] = [];
  startSettleTimer({
    settle: async () => {
      settled.push(clock.now());
      return options.fails === true
        ? Promise.reject(new BinferenceError({ code: "wallet.custody_down", message: "Down." }))
        : Promise.resolve();
    },
    isLocked: () => options.isLocked === true,
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, settled };
}

describe("the settle timer", () => {
  it("settles once a minute while the engine serves, and stops with its closer", async () => {
    const { clock, closers, settled } = timerWith();
    await clock.advance(minuteMs);
    await clock.advance(minuteMs);
    expect(settled).toStrictEqual([minuteMs, 2 * minuteMs]);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(minuteMs);
    expect(settled).toHaveLength(2);
  });

  it("waits while the engine is locked", async () => {
    const { clock, closers, settled } = timerWith({ isLocked: true });
    await clock.advance(minuteMs);
    expect(settled).toStrictEqual([]);
    await closers.closeAll(new AbortController().signal);
  });

  it("logs a settle that fails, and tries again a minute later", async () => {
    const { clock, closers, logger, settled } = timerWith({ fails: true });
    await clock.advance(minuteMs);
    await clock.advance(minuteMs);
    expect(settled).toHaveLength(2);
    expect(logger.records().map((record) => record.fields.errorCode)).toStrictEqual([
      "wallet.custody_down",
      "wallet.custody_down",
    ]);
    await closers.closeAll(new AbortController().signal);
  });
});
