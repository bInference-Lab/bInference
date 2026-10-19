import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startCopyTimer } from "./copy-timer.js";

const everyMs = 1_000;

describe("the copy timer", () => {
  it("runs the copy orders every second, and stops with its closer", async () => {
    const clock = createManualClock(0);
    const closers = createClosers();
    const runs: number[] = [];
    startCopyTimer({
      runCopies: async () => {
        runs.push(clock.now());
        return Promise.resolve();
      },
      clock,
      closers,
      logger: createMemoryLogger({ subsystem: "engine" }),
    });
    await clock.advance(everyMs);
    await clock.advance(everyMs);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(everyMs);

    expect(runs).toStrictEqual([everyMs, 2 * everyMs]);
  });
});
