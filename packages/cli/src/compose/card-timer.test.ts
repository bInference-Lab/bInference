import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { startCardTimer } from "./card-timer.js";
import { createClosers } from "./closers.js";

// A timer over a card timer that answers each run's next time from `answers`, in turn.
function timerWith(answers: readonly (number | undefined | "fails")[]) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const runs: number[] = [];
  startCardTimer({
    expireCards: async () => {
      const answer = answers[runs.length];
      runs.push(clock.now());
      return answer === "fails"
        ? Promise.reject(new BinferenceError({ code: "store.busy", message: "Busy." }))
        : Promise.resolve(answer);
    },
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, runs };
}

describe("the card timer", () => {
  it("runs at once, then at the next card's time, and stops with its closer", async () => {
    const { clock, closers, runs } = timerWith([3_250, undefined]);
    await clock.advance(0);
    await clock.advance(3_250);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(60_000);
    expect(runs).toStrictEqual([0, 3_250]);
  });

  it("looks again every 5 seconds for new cards when the next one is later or none waits", async () => {
    const { clock, closers, runs } = timerWith([60_000, undefined, 60_000]);
    await clock.advance(0);
    await clock.advance(5_000);
    await clock.advance(5_000);
    await closers.closeAll(new AbortController().signal);
    expect(runs).toStrictEqual([0, 5_000, 10_000]);
  });

  it("waits a moment before trying a card it could not close yet", async () => {
    const { clock, closers, runs } = timerWith([0, undefined]);
    await clock.advance(0);
    await clock.advance(100);
    await closers.closeAll(new AbortController().signal);
    expect(runs).toStrictEqual([0, 100]);
  });

  it("logs a run that fails, and tries again 5 seconds later", async () => {
    const { clock, closers, logger, runs } = timerWith(["fails", undefined]);
    await clock.advance(0);
    await clock.advance(5_000);
    await closers.closeAll(new AbortController().signal);
    expect(runs).toStrictEqual([0, 5_000]);
    expect(logger.records().map(({ event }) => event)).toContain("engine.card_timer_failed");
  });

  it("stops quietly when the shutdown aborts a run under way", async () => {
    const clock = createManualClock(0);
    const closers = createClosers();
    const logger = createMemoryLogger({ subsystem: "engine" });
    startCardTimer({
      expireCards: async ({ signal }) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new BinferenceError({ code: "store.aborted", message: "Aborted." })),
          );
        }),
      clock,
      closers,
      logger,
    });
    await clock.advance(0);
    await closers.closeAll(new AbortController().signal);
    expect(logger.records()).toStrictEqual([]);
  });
});
