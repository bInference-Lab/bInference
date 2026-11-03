import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startPruneTimer } from "./prune-timer.js";

const dayMs = 86_400_000;

function timerWith(options: { readonly fails?: boolean }) {
  const clock = createManualClock(0);
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const runs: number[] = [];
  startPruneTimer({
    pruneRecords: async () => {
      runs.push(clock.now());
      return options.fails === true
        ? Promise.reject(new BinferenceError({ code: "store.unavailable", message: "Gone." }))
        : Promise.resolve(3);
    },
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, runs };
}

describe("the prune timer", () => {
  it("prunes a minute after the start, then every day, and stops with its closer", async () => {
    const { clock, closers, runs } = timerWith({});
    await clock.advance(60_000);
    await clock.advance(dayMs);
    expect(runs).toStrictEqual([60_000, 60_000 + dayMs]);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(dayMs);
    expect(runs).toHaveLength(2);
  });

  it("logs a prune that fails, and prunes again a day later", async () => {
    const { clock, logger, runs } = timerWith({ fails: true });
    await clock.advance(60_000);
    await clock.advance(dayMs);
    expect(runs).toHaveLength(2);
    expect(logger.records().map(({ event }) => event)).toContain("engine.prune_failed");
  });
});
