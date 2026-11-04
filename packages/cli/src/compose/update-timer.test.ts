import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startUpdateTimer } from "./update-timer.js";

const minuteMs = 60_000;
const dayMs = 86_400_000;

// Random bytes that read as the 32-bit number given, big-endian.
function randomOf(draw: number) {
  return {
    bytes: (length: number) => {
      const bytes = new Uint8Array(length);
      new DataView(bytes.buffer).setUint32(0, draw);
      return bytes;
    },
  };
}

async function runsWith(draw: number, advances: readonly number[]): Promise<readonly number[]> {
  const clock = createManualClock(0);
  const closers = createClosers();
  const runs: number[] = [];
  startUpdateTimer({
    check: async () => {
      runs.push(clock.now());
      return Promise.resolve();
    },
    clock,
    random: randomOf(draw),
    closers,
    logger: createMemoryLogger({ subsystem: "engine" }),
  });
  for (const step of advances) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the clock moves one step at a time
    await clock.advance(step);
  }
  await closers.closeAll(new AbortController().signal);
  return runs;
}

describe("the update timer", () => {
  it("checks first 5 to 65 minutes after the start, then every day", async () => {
    const earliest = await runsWith(0, [5 * minuteMs - 1, 1, dayMs]);
    const latest = await runsWith(60 * minuteMs - 1, [65 * minuteMs - 2, 1, dayMs]);

    expect(earliest).toStrictEqual([5 * minuteMs, 5 * minuteMs + dayMs]);
    expect(latest).toStrictEqual([65 * minuteMs - 1, 65 * minuteMs - 1 + dayMs]);
  });
});
