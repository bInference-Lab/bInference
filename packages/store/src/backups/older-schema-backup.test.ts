import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idSchema } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { engineWorker } from "../databases/engine-database.js";
import { type DatabaseHandle, openDatabase } from "../host/open-database.js";
import { createSqliteInstallStore } from "../install/sqlite-install-store.js";
import {
  knownSchemaVersions,
  oldestUpdatedEngineSchemaVersion,
} from "../migrations/known-schema-versions.js";
import { writeOlderInstall } from "../sqlite/older-install.worker.js";
import { createSqliteBackupStore } from "./sqlite-backup-store.js";

// Workers run the TypeScript source, as in the host's own tests.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const workerTest = { timeout: 60_000 };
const call = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(30_000) });
const ownerKeyPublic = "b3duZXIga2V5";

const opened: DatabaseHandle[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (handle) => handle.close()));
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});

// Every schema an update may start from that a migration will still change.
const olderVersions = Array.from(
  { length: knownSchemaVersions().engine - oldestUpdatedEngineSchemaVersion },
  (_, index) => oldestUpdatedEngineSchemaVersion + index,
);

// `engine.sqlite` as an older release left it, opened as a start opens it: not migrated yet.
async function openOlder(version: number): Promise<DatabaseHandle> {
  const folder = mkdtempSync(join(tmpdir(), "bnf-older-"));
  folders.push(folder);
  const file = join(folder, "engine.sqlite");
  writeOlderInstall(file, { version, ownerKeyPublic });
  const handle = await openDatabase({ file, worker: engineWorker, execArgv, ...call() });
  opened.push(handle);
  return handle;
}

describe("the store tasks of the backup before a migration", () => {
  it.each(olderVersions)("run on an engine database at schema %i", workerTest, async (version) => {
    const handle = await openOlder(version);
    const install = createSqliteInstallStore(handle);
    const backups = createSqliteBackupStore(handle);
    const id = idSchema("bkp").parse("bkp_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    const backup = { id, path: "/b/1.bnfbak", bytes: 9, kind: "before_migration" as const };

    expect(handle.schemaVersion).toBe(version);
    const installId = idSchema("ins").parse("ins_0190f1c2-3a4b-7c5d-8e6f-000000000001");
    expect(await install.installId({ id: installId, atMs: 5 }, call())).toBe(installId);
    expect(await install.readBackupFacts(call())).toStrictEqual({
      custody: { appId: "older-app", ownerKeyPublic, attachedAtMs: 1000 },
      wallets: [
        { custodyWalletId: "older-wallet-1" },
        { custodyWalletId: "older-wallet-2", archivedAtMs: 3000 },
      ],
    });
    await backups.record({ ...backup, createdAtMs: 6 }, call());
    expect(await backups.markVerified({ id, atMs: 7 }, call())).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(await backups.list(call())).toStrictEqual([
      { ...backup, createdAtMs: 6, verifiedAtMs: 7 },
    ]);
    await backups.forget([id], call());
    expect(await backups.list(call())).toStrictEqual([]);
  });
});
