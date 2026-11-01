import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { startBridgeTimer } from "./bridge-timer.js";
import { createClosers } from "./closers.js";

const passMs = 30_000;

function timerWith(options: { readonly fails?: boolean }) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const runs: number[] = [];
  startBridgeTimer({
    followBridges: async () => {
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

describe("the bridge follow timer", () => {
  it("follows the bridges every 30 seconds, and stops with its closer", async () => {
    const { clock, closers, runs } = timerWith({});
    await clock.advance(passMs);
    await clock.advance(passMs);
    expect(runs).toStrictEqual([passMs, 2 * passMs]);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(passMs);
    expect(runs).toHaveLength(2);
  });

  it("logs a pass that fails, and follows again 30 seconds later", async () => {
    const { clock, logger, runs } = timerWith({ fails: true });
    await clock.advance(passMs);
    await clock.advance(passMs);
    expect(runs).toHaveLength(2);
    expect(logger.records().map(({ event }) => event)).toContain("engine.bridge_follow_failed");
  });
});
