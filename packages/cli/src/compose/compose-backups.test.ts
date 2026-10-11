import { idSchema } from "@binference/core";
import type { BackupKind } from "@binference/engine/backups";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { testOwnerKey } from "../backups/backup-fixtures.js";
import { backupMachine, type MachineOptions } from "../backups/backup-machine.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { backUpBeforeMigration, missedNight } from "./compose-backups.js";

const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;
const config = configSchema.parse({
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
});

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function backedUp(options: MachineOptions) {
  const machine = await backupMachine(folders, options);
  const outcome = await backUpBeforeMigration(machine.parts, config, signal());
  return { outcome, backups: await machine.parts.backups.list({ signal: signal() }) };
}

describe("the backup before a migration", () => {
  it("backs up a database a migration will change, with the version it opened with", async () => {
    const owner = await testOwnerKey();

    const { outcome, backups } = await backedUp({
      ownerKeyPublic: owner.publicKey,
      schemaVersion: 18,
    });

    expect(outcome).toStrictEqual({ ok: true, value: undefined });
    expect(backups.map((backup) => [backup.kind, backup.verifiedAtMs !== undefined])).toStrictEqual(
      [["before_migration", true]],
    );
  });

  it("takes none for a new database or one at this build's version", async () => {
    const owner = await testOwnerKey();

    const fresh = await backedUp({ ownerKeyPublic: owner.publicKey, schemaVersion: 0 });
    const current = await backedUp({ ownerKeyPublic: owner.publicKey, schemaVersion: 20 });

    expect([fresh.backups, current.backups]).toStrictEqual([[], []]);
    expect([fresh.outcome.ok, current.outcome.ok]).toStrictEqual([true, true]);
  });

  it("lets the migration go on for an install with no owner key yet", async () => {
    expect((await backedUp({ schemaVersion: 18 })).outcome).toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it("stops the migration when its backup fails", async () => {
    const owner = await testOwnerKey();

    const { outcome } = await backedUp({
      ownerKeyPublic: owner.publicKey,
      schemaVersion: 18,
      snapshotFails: true,
    });

    expect(outcome).toStrictEqual({ ok: false, error: "snapshot" });
  });
});

describe("a missed night", () => {
  const hourMs = 3_600_000;
  let made = 0;

  async function recorded(
    machine: Awaited<ReturnType<typeof backupMachine>>,
    backup: { readonly kind: BackupKind; readonly agoMs: number; readonly isVerified: boolean },
  ): Promise<void> {
    made += 1;
    const id = idSchema("bkp").parse(
      `bkp_0190f1c2-3a4b-7c5d-8e6f-${String(made).padStart(12, "0")}`,
    );
    const createdAtMs = machine.clock.now() - backup.agoMs;
    const { backups } = machine.parts;
    await backups.record(
      { id, path: `/b/${id}`, bytes: 1, kind: backup.kind, createdAtMs },
      {
        signal: signal(),
      },
    );
    if (backup.isVerified) {
      await backups.markVerified({ id, atMs: createdAtMs }, { signal: signal() });
    }
  }

  it("is missed when the newest verified scheduled backup is more than a day old", async () => {
    const owner = await testOwnerKey();
    const machine = await backupMachine(folders, { ownerKeyPublic: owner.publicKey });
    await recorded(machine, { kind: "daily", agoMs: 30 * hourMs, isVerified: true });
    await recorded(machine, { kind: "manual", agoMs: hourMs, isVerified: true });
    await recorded(machine, { kind: "daily", agoMs: hourMs, isVerified: false });

    expect(await missedNight(machine.parts, signal())).toBe(true);
    await recorded(machine, { kind: "weekly", agoMs: 2 * hourMs, isVerified: true });
    expect(await missedNight(machine.parts, signal())).toBe(false);
  });

  it("counts from the attach with no scheduled backup, and misses none with no owner key", async () => {
    const owner = await testOwnerKey();
    const attached = await backupMachine(folders, { ownerKeyPublic: owner.publicKey });
    const keyless = await backupMachine(folders, {});

    expect(await missedNight(attached.parts, signal())).toBe(true);
    expect(await missedNight(keyless.parts, signal())).toBe(false);
  });
});
