import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { Engine } from "@binference/engine";
import type { DowntimeReport } from "@binference/engine/orders";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startDowntimeTimer } from "./downtime-timer.js";

const startMs = Date.parse("2026-10-20T08:00:00Z");
const minuteMs = 60_000;
const stop = new AbortController().signal;

// A manual clock whose wall time can jump ahead or back while its sleepers stay put, as when the
// machine sleeps or its clock is set: a timer's sleep stops with the machine, the wall clock does
// not.
function steppedClock() {
  const manual = createManualClock(startMs);
  const stepped = { ms: 0 };
  return {
    now: () => manual.now() + stepped.ms,
    sleep: async (delayMs: number, signal: AbortSignal) => manual.sleep(delayMs, signal),
    advance: async (delayMs: number) => manual.advance(delayMs),
    step: (byMs: number): void => {
      stepped.ms += byMs;
    },
  };
}

const report: DowntimeReport = { cause: "wake", offFromMs: startMs, offMs: 0, orders: [] };
const time = (atMs: number): string => new Date(atMs).toISOString().slice(11, 19);

// The engine's re-check as a test sees it: each call it gets, with the time it came.
function fakeDowntime(clock: { readonly now: () => number }) {
  const calls: string[] = [];
  const downtime: Engine["downtime"] = {
    started: async () => {
      calls.push(`started ${time(clock.now())}`);
      return Promise.resolve({ reported: Promise.resolve({ ...report, cause: "start" }) });
    },
    paused: async (pause) => {
      const span = `${time(pause.fromMs)} for ${String(pause.offMs / 1_000)} s`;
      calls.push(`${pause.cause} ${time(clock.now())} from ${span}`);
      return Promise.resolve({ reported: Promise.resolve(report) });
    },
    alive: async () => {
      calls.push(`alive ${time(clock.now())}`);
      return Promise.resolve();
    },
    findPausesWith: () => undefined,
  };
  return { downtime, calls };
}

async function timerWith() {
  const clock = steppedClock();
  const fake = fakeDowntime(clock);
  const pauses = { count: 0 };
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const running = await startDowntimeTimer({
    downtime: fake.downtime,
    onPause: () => {
      pauses.count += 1;
    },
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, pauses, calls: fake.calls, check: running.check };
}

describe("the downtime timer", () => {
  it("re-checks at the start, then marks the engine alive each minute and as it stops", async () => {
    const timer = await timerWith();
    await timer.clock.advance(2 * minuteMs);
    await timer.closers.closeAll(stop);

    expect(timer.calls).toStrictEqual([
      "started 08:00:00",
      "alive 08:01:00",
      "alive 08:02:00",
      "alive 08:02:00",
    ]);
    expect(timer.pauses.count).toBe(0);
  });

  it("finds a sleep at the first price after it, before the tick, and fences once", async () => {
    const timer = await timerWith();
    await timer.clock.advance(10_000);

    timer.clock.step(30 * minuteMs);
    const first = timer.check();
    const second = timer.check();
    await timer.clock.advance(5_000);
    await timer.closers.closeAll(stop);

    expect([first, second]).toStrictEqual([true, false]);
    expect(timer.calls.slice(0, 2)).toStrictEqual([
      "started 08:00:00",
      "wake 08:30:10 from 08:00:15 for 1795 s",
    ]);
    expect(timer.pauses.count).toBe(1);
    expect(timer.logger.records()).toContainEqual(
      expect.objectContaining({ event: "engine.woke", fields: { durationMs: 1_795_000 } }),
    );
  });

  it("finds a clock set back, re-checks it as a pause, and goes on marking the engine alive", async () => {
    const timer = await timerWith();
    await timer.clock.advance(minuteMs);

    timer.clock.step(-10 * minuteMs);
    await timer.clock.advance(minuteMs + 5_000);
    await timer.closers.closeAll(stop);

    expect(timer.calls).toContain("clock 07:51:05 from 08:01:00 for 595 s");
    expect(timer.calls).toContain("alive 07:52:05");
    expect(timer.pauses.count).toBe(1);
  });

  it("takes a jump of less than a minute for a slow tick, not a pause", async () => {
    const timer = await timerWith();
    timer.clock.step(50_000);
    await timer.clock.advance(5_000);
    await timer.closers.closeAll(stop);

    expect(timer.calls.some((call) => /^(wake|clock) /.test(call))).toBe(false);
    expect(timer.pauses.count).toBe(0);
  });
});
