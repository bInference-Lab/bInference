import { idSchema } from "@binference/core";
import type { BackupKind, BackupRecord } from "@binference/engine/backups";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { backupsToDrop, type BackupsKept } from "./backup-retention.js";

const kept: BackupsKept = { daily: 7, weekly: 4, beforeChanges: 3 };
const dayMs = 86_400_000;

function backupOf(n: number, kind: BackupKind, isVerified = true): BackupRecord {
  const id = idSchema("bkp").parse(
    `bkp_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`,
  );
  const backup = { id, path: `/b/${String(n)}`, bytes: 1, kind, createdAtMs: n * dayMs };
  return isVerified ? { ...backup, verifiedAtMs: n * dayMs + 1 } : backup;
}

// Sixty nights of scheduled backups, Sundays weekly, as the timer takes them.
const nights = Array.from({ length: 60 }, (_, index) =>
  backupOf(index + 1, (index + 1) % 7 === 0 ? "weekly" : "daily"),
);

const kindArbitrary = fc.constantFrom<BackupKind>(
  "daily",
  "weekly",
  "manual",
  "before_update",
  "before_migration",
);
const backupsArbitrary = fc
  .uniqueArray(fc.integer({ min: 1, max: 10_000 }), { maxLength: 60 })
  .chain((numbers) =>
    fc.tuple(
      ...numbers.map((n) =>
        fc
          .tuple(kindArbitrary, fc.boolean())
          .map(([kind, isVerified]) => backupOf(n, kind, isVerified)),
      ),
    ),
  );
const keptArbitrary = fc.record({
  daily: fc.integer({ min: 1, max: 10 }),
  weekly: fc.integer({ min: 1, max: 6 }),
  beforeChanges: fc.integer({ min: 1, max: 4 }),
});

const isVerifiedManual = (backup: BackupRecord): boolean =>
  backup.kind === "manual" && backup.verifiedAtMs !== undefined;

function keptOf(backups: readonly BackupRecord[], limits: BackupsKept): readonly BackupRecord[] {
  const dropped = new Set(backupsToDrop(backups, limits));
  return backups.filter((backup) => !dropped.has(backup));
}

describe("backup retention", () => {
  it("keeps the last 7 nights and the last 4 Sundays of a long run", () => {
    const left = keptOf(nights, kept).map((backup) => backup.createdAtMs / dayMs);

    expect(left).toStrictEqual([35, 42, 49, 54, 55, 56, 57, 58, 59, 60]);
  });

  it("keeps the last 3 taken before updates and migrations together, and every manual one", () => {
    const backups = [
      backupOf(1, "before_migration"),
      backupOf(2, "before_update"),
      backupOf(3, "manual"),
      backupOf(4, "before_migration"),
      backupOf(5, "before_update"),
    ];

    expect(backupsToDrop(backups, kept).map((backup) => backup.createdAtMs / dayMs)).toStrictEqual([
      1,
    ]);
  });

  it("drops every backup no check passed on", () => {
    const backups = [
      backupOf(1, "daily", false),
      backupOf(2, "manual", false),
      backupOf(3, "daily"),
    ];

    expect(backupsToDrop(backups, kept).map((backup) => backup.createdAtMs / dayMs)).toStrictEqual([
      1, 2,
    ]);
  });

  it("keeps exactly the newest of each kind up to its limit, in any order of rows", () => {
    fc.assert(
      fc.property(backupsArbitrary, keptArbitrary, (backups, limits) => {
        const left = new Set(keptOf(backups, limits));
        const verified = backups.filter((backup) => backup.verifiedAtMs !== undefined);
        const newestOf = (kinds: readonly BackupKind[], count: number) =>
          verified
            .filter((backup) => kinds.includes(backup.kind))
            .toSorted((a, b) => b.createdAtMs - a.createdAtMs)
            .slice(0, count);
        const expected = new Set([
          ...newestOf(["daily", "weekly"], limits.daily),
          ...newestOf(["weekly"], limits.weekly),
          ...newestOf(["before_update", "before_migration"], limits.beforeChanges),
          ...verified.filter((backup) => backup.kind === "manual"),
        ]);
        expect(left).toStrictEqual(expected);
        expect(new Set(keptOf(backups.toReversed(), limits))).toStrictEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("never drops a verified manual backup, and drops nothing twice", () => {
    fc.assert(
      fc.property(backupsArbitrary, keptArbitrary, (backups, limits) => {
        const dropped = backupsToDrop(backups, limits);
        expect(new Set(dropped).size).toBe(dropped.length);
        expect(dropped.filter(isVerifiedManual)).toStrictEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
