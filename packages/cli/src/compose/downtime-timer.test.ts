import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { Engine } from "@binference/engine";
import type { DowntimeReport } from "@binference/engine/orders";
import { describe, expect, it } from "vitest";
import { createClosers } from "./closers.js";
import { startDowntimeTimer } from "./downtime-timer.js";

const startMs = Date.parse("2026-10-20T08:00:00Z");
const minuteMs = 60_000;
const stop = new AbortController().signal;

// A manual clock whose wall time can jump ahead while its sleepers stay put, as when the machine
// sleeps: a timer's sleep stops with the machine, the wall clock does not.
function sleepyClock() {
  const manual = createManualClock(startMs);
  const asleep = { ms: 0 };
  return {
    now: () => manual.now() + asleep.ms,
    sleep: async (delayMs: number, signal: AbortSignal) => manual.sleep(delayMs, signal),
    advance: async (delayMs: number) => manual.advance(delayMs),
    sleepFor: (delayMs: number): void => {
      asleep.ms += delayMs;
    },
  };
}

const report: DowntimeReport = { cause: "wake", offFromMs: startMs, offMs: 0, orders: [] };

// The engine's re-check as a test sees it: each call it gets, with the time it came.
function fakeDowntime(clock: { readonly now: () => number }) {
  const calls: string[] = [];
  const at = (): string => new Date(clock.now()).toISOString().slice(11, 19);
  const downtime: Engine["downtime"] = {
    started: async () => {
      calls.push(`started ${at()}`);
      return Promise.resolve({ reported: Promise.resolve({ ...report, cause: "start" }) });
    },
    woke: async (asleepFromMs) => {
      calls.push(`woke ${at()} from ${new Date(asleepFromMs).toISOString().slice(11, 19)}`);
      return Promise.resolve({ reported: Promise.resolve(report) });
    },
    alive: async () => {
      calls.push(`alive ${at()}`);
      return Promise.resolve();
    },
  };
  return { downtime, calls };
}

async function timerWith() {
  const clock = sleepyClock();
  const fake = fakeDowntime(clock);
  const sleeps: number[] = [];
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  await startDowntimeTimer({
    downtime: fake.downtime,
    onSleep: (asleepMs) => sleeps.push(asleepMs),
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, sleeps, calls: fake.calls };
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
    expect(timer.sleeps).toStrictEqual([]);
  });

  it("re-checks after a jump of the wall clock past a minute, as a sleep of the machine", async () => {
    const timer = await timerWith();
    await timer.clock.advance(10_000);

    timer.clock.sleepFor(30 * minuteMs);
    await timer.clock.advance(5_000);
    await timer.closers.closeAll(stop);

    expect(timer.calls.slice(0, 3)).toStrictEqual([
      "started 08:00:00",
      "woke 08:30:15 from 08:00:10",
      "alive 08:30:15",
    ]);
    expect(timer.sleeps).toStrictEqual([30 * minuteMs + 5_000]);
    expect(timer.logger.records()).toContainEqual(
      expect.objectContaining({
        event: "engine.woke",
        fields: { durationMs: 30 * minuteMs + 5_000 },
      }),
    );
  });

  it("takes a jump of less than a minute for a slow tick, not a sleep", async () => {
    const timer = await timerWith();
    timer.clock.sleepFor(50_000);
    await timer.clock.advance(5_000);
    await timer.closers.closeAll(stop);

    expect(timer.calls.filter((call) => call.startsWith("woke"))).toStrictEqual([]);
    expect(timer.sleeps).toStrictEqual([]);
  });
});
