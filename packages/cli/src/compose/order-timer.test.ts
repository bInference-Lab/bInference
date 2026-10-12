import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startOrderTimer } from "./order-timer.js";

const tickMs = 10_000;

function timerWith(options: { readonly fails?: boolean } = {}) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const ticks: number[] = [];
  startOrderTimer({
    tickOrders: async () => {
      ticks.push(clock.now());
      return options.fails === true
        ? Promise.reject(new BinferenceError({ code: "store.busy", message: "Busy." }))
        : Promise.resolve();
    },
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, ticks };
}

describe("the order timer", () => {
  it("ticks every 10 seconds while the engine serves, and stops with its closer", async () => {
    const { clock, closers, ticks } = timerWith();
    await clock.advance(tickMs);
    await clock.advance(tickMs);
    expect(ticks).toStrictEqual([tickMs, 2 * tickMs]);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(tickMs);
    expect(ticks).toHaveLength(2);
  });

  it("logs a tick that fails, and tries again 10 seconds later", async () => {
    const { clock, closers, logger, ticks } = timerWith({ fails: true });
    await clock.advance(tickMs);
    await clock.advance(tickMs);
    expect(ticks).toHaveLength(2);
    expect(logger.records().map(({ event }) => event)).toContain("engine.order_tick_failed");
    await closers.closeAll(new AbortController().signal);
  });
});
