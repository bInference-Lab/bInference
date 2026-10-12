import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startRepeatingTimer } from "./repeating-timer.js";

function timerOver(run: (signal: AbortSignal) => Promise<void>) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  startRepeatingTimer({
    name: "test",
    run: async ({ signal }) => run(signal),
    everyMs: 1_000,
    failedEvent: "engine.test_failed",
    isLocked: () => false,
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger };
}

describe("the repeating timer", () => {
  it("logs a run that fails, with its code", async () => {
    const { clock, closers, logger } = timerOver(async () => {
      await Promise.reject(new BinferenceError({ code: "store.busy", message: "Busy." }));
    });
    await clock.advance(1_000);
    await closers.closeAll(new AbortController().signal);
    expect(logger.records()).toMatchObject([
      { level: "warn", event: "engine.test_failed", fields: { errorCode: "store.busy" } },
    ]);
  });

  it("stops quietly when the shutdown aborts a run under way", async () => {
    const { clock, closers, logger } = timerOver(
      async (signal) =>
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new BinferenceError({ code: "store.aborted", message: "Aborted." })),
          );
        }),
    );
    await clock.advance(1_000);
    await closers.closeAll(new AbortController().signal);
    expect(logger.records()).toStrictEqual([]);
  });
});
