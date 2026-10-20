import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startSummaryTimer } from "./summary-timer.js";

const minuteMs = 60_000;

function timerWith(options: { readonly fails?: boolean }) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const runs: number[] = [];
  startSummaryTimer({
    sendDailySummaries: async () => {
      runs.push(clock.now());
      return options.fails === true
        ? Promise.reject(new BinferenceError({ code: "store.unavailable", message: "Gone." }))
        : Promise.resolve();
    },
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, runs };
}

describe("the daily summary timer", () => {
  it("runs the summaries once a minute, and stops with its closer", async () => {
    const { clock, closers, runs } = timerWith({});
    await clock.advance(minuteMs);
    await clock.advance(minuteMs);
    expect(runs).toStrictEqual([minuteMs, 2 * minuteMs]);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(minuteMs);
    expect(runs).toHaveLength(2);
  });

  it("logs a run that fails, and runs again a minute later", async () => {
    const { clock, closers, logger, runs } = timerWith({ fails: true });
    await clock.advance(minuteMs);
    await clock.advance(minuteMs);
    expect(runs).toHaveLength(2);
    expect(logger.records().map((record) => [record.event, record.fields.errorCode])).toStrictEqual(
      [
        ["engine.daily_summary_failed", "store.unavailable"],
        ["engine.daily_summary_failed", "store.unavailable"],
      ],
    );
    await closers.closeAll(new AbortController().signal);
  });
});
