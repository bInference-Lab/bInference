import { BinferenceError, err, idSchema, ok } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { EnginePush } from "@binference/engine";
import type { BackupFailure, BackupRecord } from "@binference/engine/backups";
import { describe, expect, it } from "vitest";
import { type BackupSchedule, startBackupTimer } from "./backup-timer.js";
import { createClosers } from "./closers.js";

const at = (iso: string): number => Date.parse(iso);
const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

function recordOf(atMs: number): BackupRecord {
  const id = idSchema("bkp").parse("bkp_0190f1c2-3a4b-7c5d-8e6f-000000000001");
  return { id, path: "/b", bytes: 1, kind: "daily", createdAtMs: atMs, verifiedAtMs: atMs };
}

// A manual clock whose wall time can jump ahead while its sleepers stay put, as when the machine
// sleeps: a timer's sleep stops with the machine, the wall clock does not.
function sleepyClock(startMs: number) {
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

function timerWith(options: {
  readonly startIso: string;
  readonly schedule: { value: BackupSchedule };
  readonly answer?: () => Promise<BackupFailure | undefined>;
  readonly missed?: () => Promise<boolean>;
}) {
  const clock = sleepyClock(at(options.startIso));
  const closers = createClosers();
  const logger = createMemoryLogger({ subsystem: "engine" });
  const taken: (readonly [string, string])[] = [];
  const pushes: EnginePush[] = [];
  startBackupTimer({
    takeBackup: async (kind) => {
      taken.push([new Date(clock.now()).toISOString(), kind]);
      const failure = await (options.answer?.() ?? Promise.resolve(undefined));
      return failure === undefined ? ok(recordOf(clock.now())) : err(failure);
    },
    isNightMissed: async () => (options.missed ?? (async () => Promise.resolve(false)))(),
    schedule: () => options.schedule.value,
    publish: (push) => pushes.push(push),
    clock,
    closers,
    logger,
  });
  return { clock, closers, logger, taken, pushes };
}

const utc = { isOn: true, timeZone: "UTC" };
const stop = new AbortController().signal;

describe("the nightly backup timer", () => {
  it("takes a backup at 03:30 each night, Sunday's weekly, and stops with its closer", async () => {
    const timer = timerWith({ startIso: "2026-10-10T12:00:00Z", schedule: { value: utc } });

    await timer.clock.advance(3 * dayMs);

    expect(timer.taken).toStrictEqual([
      ["2026-10-11T03:30:00.000Z", "weekly"],
      ["2026-10-12T03:30:00.000Z", "daily"],
      ["2026-10-13T03:30:00.000Z", "daily"],
    ]);
    expect(timer.pushes).toStrictEqual([]);
    await timer.closers.closeAll(stop);
    await timer.clock.advance(2 * dayMs);
    expect(timer.taken).toHaveLength(3);
  });

  it("follows a new timezone within a minute", async () => {
    const schedule = { value: utc };
    const timer = timerWith({ startIso: "2026-10-12T12:00:00Z", schedule });

    await timer.clock.advance(hourMs);
    schedule.value = { isOn: true, timeZone: "Asia/Shanghai" };
    await timer.clock.advance(dayMs);

    expect(timer.taken).toStrictEqual([["2026-10-12T19:30:00.000Z", "daily"]]);
    await timer.closers.closeAll(stop);
  });

  it("skips the nights the daily switch is off", async () => {
    const schedule = { value: { ...utc, isOn: false } };
    const timer = timerWith({ startIso: "2026-10-12T12:00:00Z", schedule });

    await timer.clock.advance(dayMs);
    schedule.value = utc;
    await timer.clock.advance(dayMs);

    expect(timer.taken).toStrictEqual([["2026-10-14T03:30:00.000Z", "daily"]]);
    await timer.closers.closeAll(stop);
  });

  it("raises the backup failed notice with the reason, and tries again the next night", async () => {
    const timer = timerWith({
      startIso: "2026-10-12T12:00:00Z",
      schedule: { value: utc },
      answer: async () => Promise.resolve("check"),
    });

    await timer.clock.advance(2 * dayMs);

    expect(timer.taken).toHaveLength(2);
    expect(timer.pushes.map((push) => push.data)).toStrictEqual([
      { key: "notice.backupFailed", values: { reason: "check" } },
      { key: "notice.backupFailed", values: { reason: "check" } },
    ]);
    await timer.closers.closeAll(stop);
  });

  it("logs a backup that throws, and names it a failed write", async () => {
    const timer = timerWith({
      startIso: "2026-10-12T12:00:00Z",
      schedule: { value: utc },
      answer: async () => Promise.reject(new BinferenceError({ code: "store.busy", message: "x" })),
    });

    await timer.clock.advance(dayMs);

    expect(timer.pushes.map((push) => push.data)).toStrictEqual([
      { key: "notice.backupFailed", values: { reason: "write" } },
    ]);
    expect(timer.logger.records().map((record) => record.fields.errorCode)).toStrictEqual([
      "store.busy",
    ]);
    await timer.closers.closeAll(stop);
  });

  it("takes a missed night's backup at once when the engine starts, Sunday's weekly", async () => {
    const timer = timerWith({
      startIso: "2026-10-11T09:00:00Z",
      schedule: { value: utc },
      missed: async () => Promise.resolve(true),
    });

    await timer.clock.advance(0);
    expect(timer.taken).toStrictEqual([["2026-10-11T09:00:00.000Z", "weekly"]]);
    await timer.clock.advance(dayMs);
    expect(timer.taken).toStrictEqual([
      ["2026-10-11T09:00:00.000Z", "weekly"],
      ["2026-10-12T03:30:00.000Z", "daily"],
    ]);
    await timer.closers.closeAll(stop);
  });

  it("takes a missed night's backup at the first tick after the machine wakes", async () => {
    const missed = { value: false };
    const timer = timerWith({
      startIso: "2026-10-12T12:00:00Z",
      schedule: { value: utc },
      missed: async () => Promise.resolve(missed.value),
    });
    await timer.clock.advance(hourMs);

    missed.value = true;
    timer.clock.sleepFor(10 * hourMs);
    await timer.clock.advance(60_000);

    expect(timer.taken).toStrictEqual([["2026-10-12T23:01:00.000Z", "daily"]]);
    await timer.clock.advance(hourMs);
    expect(timer.taken).toHaveLength(1);
    await timer.closers.closeAll(stop);
  });

  it("takes nothing more after a wake that finds the last night's backup", async () => {
    const timer = timerWith({ startIso: "2026-10-12T12:00:00Z", schedule: { value: utc } });

    timer.clock.sleepFor(6 * hourMs);
    await timer.clock.advance(hourMs);

    expect(timer.taken).toStrictEqual([]);
    await timer.closers.closeAll(stop);
  });

  it("takes the night's backup once when the machine wakes after 03:30", async () => {
    const timer = timerWith({
      startIso: "2026-10-12T22:00:00Z",
      schedule: { value: utc },
      missed: async () => Promise.resolve(true),
    });
    await timer.clock.advance(0);
    const atStart = timer.taken.length;

    timer.clock.sleepFor(10 * hourMs);
    await timer.clock.advance(hourMs);

    expect(timer.taken.slice(atStart)).toStrictEqual([["2026-10-13T08:01:00.000Z", "daily"]]);
    await timer.closers.closeAll(stop);
  });

  it("takes no missed night's backup while the daily switch is off", async () => {
    const timer = timerWith({
      startIso: "2026-10-12T12:00:00Z",
      schedule: { value: { ...utc, isOn: false } },
      missed: async () => Promise.resolve(true),
    });

    timer.clock.sleepFor(10 * hourMs);
    await timer.clock.advance(hourMs);

    expect(timer.taken).toStrictEqual([]);
    await timer.closers.closeAll(stop);
  });

  it("logs a history it cannot read, and waits for 03:30", async () => {
    const timer = timerWith({
      startIso: "2026-10-12T12:00:00Z",
      schedule: { value: utc },
      missed: async () => Promise.reject(new BinferenceError({ code: "store.busy", message: "x" })),
    });

    await timer.clock.advance(dayMs);

    expect(timer.taken).toStrictEqual([["2026-10-13T03:30:00.000Z", "daily"]]);
    expect(timer.logger.records().map((record) => record.event)).toContain("backup.history_unread");
    await timer.closers.closeAll(stop);
  });

  it("logs nothing of a history read the engine's stop cuts off", async () => {
    const timer = timerWith({
      startIso: "2026-10-12T12:00:00Z",
      schedule: { value: utc },
      missed: async () =>
        Promise.reject(new BinferenceError({ code: "store.aborted", message: "x" })),
    });

    await timer.closers.closeAll(stop);

    expect(timer.logger.records()).toStrictEqual([]);
    expect(timer.taken).toStrictEqual([]);
  });
});
