import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { testOwnerKey } from "../backups/backup-fixtures.js";
import { backupMachine, type MachineOptions } from "../backups/backup-machine.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { backUpBeforeMigration } from "./compose-backups.js";

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
