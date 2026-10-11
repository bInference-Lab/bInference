import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  type FilePermissions,
  fileSize,
  listFolderFiles,
  readFilePieces,
  writePrivateFile,
} from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { joined, testOwnerKey, valueOf } from "./backup-fixtures.js";
import {
  type BackupMachine,
  backupMachine,
  installId,
  type MachineOptions,
  nowMs,
} from "./backup-machine.js";
import { checkArchive } from "./check-archive.js";
import { openBody } from "./chunk-stream.js";
import { openBackup } from "./open-backup.js";
import { type BackupRun, takeBackup } from "./take-backup.js";

const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const machineOf = async (options: MachineOptions = {}): Promise<BackupMachine> =>
  backupMachine(folders, options);

// Flips the last byte of the backup file a folder holds, as the folder is synced after the write.
async function changeBackupIn(path: string): Promise<void> {
  const name = (await listFolderFiles(path, signal())).find((file) => file.endsWith(".bnfbak"));
  if (name === undefined) {
    return;
  }
  const file = join(path, name);
  const bytes = await joined(readFilePieces(file, { signal: signal() }));
  bytes.writeUInt8(bytes.readUInt8(bytes.length - 1) ^ 1, bytes.length - 1);
  await writePrivateFile(file, bytes, { permissions: noPermissions, signal: signal() });
}

async function onlyBackup(machine: BackupMachine) {
  const [kept, ...more] = await machine.parts.backups.list({ signal: signal() });
  if (kept === undefined || more.length > 0) {
    throw new Error("Expected one backup.");
  }
  return kept;
}

function runOf(overrides: Partial<BackupRun> = {}): BackupRun {
  return {
    kind: "daily",
    engineSchemaVersion: 20,
    configVersion: 4,
    kept: { daily: 7, weekly: 4, beforeChanges: 3 },
    signal: signal(),
    ...overrides,
  };
}

describe("taking a backup", () => {
  it("writes, checks, records and copies a backup only the owner key opens", async () => {
    const owner = await testOwnerKey();
    const machine = await machineOf({ ownerKeyPublic: owner.publicKey });
    const copyTo = join(machine.root, "elsewhere");

    const taken = valueOf(await takeBackup(machine.parts, runOf({ copyTo })));

    expect(taken).toMatchObject({ kind: "daily", createdAtMs: nowMs, verifiedAtMs: nowMs });
    expect(taken.path).toBe(
      join(machine.root, "backups", `binference-${installId}-20261012-0330-daily.bnfbak`),
    );
    expect(await machine.parts.backups.list({ signal: signal() })).toStrictEqual([taken]);
    expect(await listFolderFiles(join(machine.root, "backups"), signal())).toStrictEqual([
      `binference-${installId}-20261012-0330-daily.bnfbak`,
    ]);
    expect(
      await joined(
        readFilePieces(join(copyTo, `binference-${installId}-20261012-0330-daily.bnfbak`), {
          signal: signal(),
        }),
      ),
    ).toStrictEqual(await joined(readFilePieces(taken.path, { signal: signal() })));
    const opened = valueOf(
      await openBackup(readFilePieces(taken.path, { signal: signal() }), owner.pair),
    );
    const manifest = await checkArchive(openBody(opened.body, opened.dataKey, opened.frame));
    expect(manifest.files.map((file) => file.path)).toStrictEqual([
      "engine.sqlite",
      "config.json5",
      "workspace/agent/notes.md",
    ]);
    expect(manifest.privy).toStrictEqual({ appId: "privy-app", wallets: ["privy-wallet-1"] });
    expect(manifest.schemaVersions).toStrictEqual({ engine: 20, config: 4 });
  });

  it("records the SHA-256 of the file and of its header line", async () => {
    const owner = await testOwnerKey();
    const machine = await machineOf({ ownerKeyPublic: owner.publicKey });

    const taken = valueOf(await takeBackup(machine.parts, runOf()));

    const bytes = await joined(readFilePieces(taken.path, { signal: signal() }));
    const line = bytes.subarray(0, bytes.indexOf(0x0a));
    expect(taken.fileSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(taken.headerSha256).toBe(createHash("sha256").update(line).digest("hex"));
  });

  it("never writes over a backup taken the same minute", async () => {
    const owner = await testOwnerKey();
    const machine = await machineOf({ ownerKeyPublic: owner.publicKey });

    const first = valueOf(await takeBackup(machine.parts, runOf()));
    const second = valueOf(await takeBackup(machine.parts, runOf()));

    expect(second.path).toBe(first.path.replace(".bnfbak", "-2.bnfbak"));
  });

  it("takes nothing for an install with no owner key", async () => {
    const machine = await machineOf({});

    expect(await takeBackup(machine.parts, runOf())).toStrictEqual({
      ok: false,
      error: "no_owner_key",
    });
    expect(await machine.parts.backups.list({ signal: signal() })).toStrictEqual([]);
  });

  it("fails at the snapshot and leaves no file, work folder or record", async () => {
    const owner = await testOwnerKey();
    const machine = await machineOf({ ownerKeyPublic: owner.publicKey, snapshotFails: true });

    expect(await takeBackup(machine.parts, runOf())).toStrictEqual({
      ok: false,
      error: "snapshot",
    });
    expect(await listFolderFiles(join(machine.root, "backups"), signal())).toStrictEqual([]);
    expect(await machine.parts.backups.list({ signal: signal() })).toStrictEqual([]);
    expect(
      machine.logger.records().map((record) => [record.event, record.fields.errorCode]),
    ).toContainEqual(["backup.failed", "store.vacuum_failed"]);
  });

  it("fails its check when the file changed after it was written, and keeps nothing of it", async () => {
    const owner = await testOwnerKey();
    const changing: FilePermissions = { ...noPermissions, syncFolder: changeBackupIn };
    const machine = await machineOf({ ownerKeyPublic: owner.publicKey, permissions: changing });

    expect(await takeBackup(machine.parts, runOf())).toStrictEqual({ ok: false, error: "check" });
    expect(await listFolderFiles(join(machine.root, "backups"), signal())).toStrictEqual([]);
    expect(await machine.parts.backups.list({ signal: signal() })).toStrictEqual([]);
  });

  it("keeps a verified backup whose copy failed, and says the copy failed", async () => {
    const owner = await testOwnerKey();
    const machine = await machineOf({ ownerKeyPublic: owner.publicKey });
    const blocked = join(machine.root, "blocked");
    await writePrivateFile(blocked, "a file, not a folder", {
      permissions: noPermissions,
      signal: signal(),
    });

    expect(await takeBackup(machine.parts, runOf({ copyTo: blocked }))).toStrictEqual({
      ok: false,
      error: "copy",
    });
    const kept = await onlyBackup(machine);
    expect(kept.verifiedAtMs).toBe(nowMs);
    expect((await fileSize(kept.path, signal())).ok).toBe(true);
  });

  it("removes what retention no longer keeps, with its copy", async () => {
    const owner = await testOwnerKey();
    const machine = await machineOf({ ownerKeyPublic: owner.publicKey });
    const copyTo = join(machine.root, "copies");
    const kept = { daily: 1, weekly: 1, beforeChanges: 1 };
    const first = valueOf(await takeBackup(machine.parts, runOf({ copyTo, kept })));
    const copy = join(copyTo, first.path.slice(dirname(first.path).length + 1));
    await machine.clock.advance(86_400_000);

    const second = valueOf(await takeBackup(machine.parts, runOf({ copyTo, kept })));

    expect(await machine.parts.backups.list({ signal: signal() })).toStrictEqual([second]);
    expect((await fileSize(first.path, signal())).ok).toBe(false);
    expect((await fileSize(copy, signal())).ok).toBe(false);
  });
});
