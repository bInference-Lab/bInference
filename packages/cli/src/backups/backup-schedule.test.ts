import { wallClockOf } from "@binference/i18n";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nextBackupAt } from "./backup-schedule.js";

const at = (iso: string): number => Date.parse(iso);
const zones = ["UTC", "Asia/Shanghai", "America/New_York", "Europe/Berlin", "Australia/Lord_Howe"];

function wallClock(atMs: number, timeZone: string) {
  const wall = wallClockOf(atMs, timeZone);
  const time = `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
  return { time, kind: wall.weekday === 0 ? "weekly" : "daily" };
}

describe("the daily backup's schedule", () => {
  it("runs at 03:30 owner time, the same day before it and the next day after it", () => {
    expect(nextBackupAt(at("2026-10-12T03:00:00Z"), "UTC")).toStrictEqual({
      atMs: at("2026-10-12T03:30:00Z"),
      kind: "daily",
    });
    expect(nextBackupAt(at("2026-10-12T03:30:00Z"), "UTC")).toStrictEqual({
      atMs: at("2026-10-13T03:30:00Z"),
      kind: "daily",
    });
  });

  it("follows the owner's timezone, and calls Sunday's the weekly backup", () => {
    expect(nextBackupAt(at("2026-10-10T18:00:00Z"), "Asia/Shanghai")).toStrictEqual({
      atMs: at("2026-10-10T19:30:00Z"),
      kind: "weekly",
    });
    expect(nextBackupAt(at("2026-10-10T20:00:00Z"), "Asia/Shanghai")).toStrictEqual({
      atMs: at("2026-10-11T19:30:00Z"),
      kind: "daily",
    });
  });

  it("keeps 03:30 on the wall clock across a change of daylight saving time", () => {
    expect(nextBackupAt(at("2026-10-31T12:00:00Z"), "America/New_York")).toStrictEqual({
      atMs: at("2026-11-01T08:30:00Z"),
      kind: "weekly",
    });
    expect(nextBackupAt(at("2026-03-07T12:00:00Z"), "America/New_York")).toStrictEqual({
      atMs: at("2026-03-08T07:30:00Z"),
      kind: "weekly",
    });
  });

  it("always comes within a day, at 03:30 on the wall clock, weekly exactly on Sundays", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: at("2026-01-01T00:00:00Z"), max: at("2030-01-01T00:00:00Z") }),
        fc.constantFrom(...zones),
        (nowMs, zone) => {
          const next = nextBackupAt(nowMs, zone);
          const wall = wallClock(next.atMs, zone);
          expect(next.atMs).toBeGreaterThan(nowMs);
          expect(next.atMs - nowMs).toBeLessThanOrEqual(25 * 3_600_000);
          expect(wall.time).toBe("03:30");
          expect(next.kind).toBe(wall.kind);
        },
      ),
      { numRuns: 300 },
    );
  });
});
