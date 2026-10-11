import { join } from "node:path";
import { idSchema } from "@binference/core";
import {
  ensurePrivateFolder,
  listFolderFiles,
  readFilePieces,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { createP256KeyPair } from "@binference/signer";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { joined, testOwnerKey, valueOf } from "./backup-fixtures.js";
import { checkArchive } from "./check-archive.js";
import { openBody } from "./chunk-stream.js";
import { openBackup } from "./open-backup.js";
import { ownerKeyRecipient } from "./owner-key-recipient.js";
import { unpackBackup } from "./unpack-backup.js";
import { verifyBackup } from "./verify-backup.js";
import { type BackupPlan, writeBackup, type WrittenBackup } from "./write-backup.js";

const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;
const writing = { permissions: noPermissions, signal: signal() };
const installId = idSchema("ins").parse("ins_0190f1c2-3a4b-7c5d-8e6f-000000000001");

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const ownerKey = testOwnerKey;

async function stateFolder(): Promise<string> {
  const folder = await createTempFolder("bnf-bak-");
  folders.push(folder);
  await ensurePrivateFolder(join(folder.path, "workspace", "agent"), writing);
  await writePrivateFile(join(folder.path, "engine.sqlite"), Buffer.alloc(200_000, 7), writing);
  await writePrivateFile(join(folder.path, "config.json5"), "{ version: 4 }", writing);
  await writePrivateFile(join(folder.path, "workspace", "agent", "notes.md"), "notes", writing);
  return folder.path;
}

function planOf(folder: string, ownerKeyPublic: string, name = "backup.bnfbak"): BackupPlan {
  return {
    target: join(folder, name),
    installId,
    createdAt: 1_800_000_000_000,
    kind: "daily",
    binferenceVersion: "0.0.0",
    ownerKeyPublic,
    files: [
      { path: "engine.sqlite", from: join(folder, "engine.sqlite") },
      { path: "agent.sqlite", from: join(folder, "agent.sqlite") },
      { path: "config.json5", from: join(folder, "config.json5") },
      { path: "workspace/agent/notes.md", from: join(folder, "workspace", "agent", "notes.md") },
    ],
    schemaVersions: { engine: 20, config: 4 },
    privy: { appId: "app", wallets: ["wallet-1"] },
  };
}

async function written(plan: BackupPlan): Promise<WrittenBackup> {
  const done = await writeBackup(plan, writing);
  if (!done.ok) {
    throw new Error("Expected a backup.");
  }
  return done.value;
}

async function* recorded(path: string, pulls: number[]): AsyncGenerator<Uint8Array> {
  for await (const piece of readFilePieces(path, { pieceBytes: 4_096, signal: signal() })) {
    pulls.push(piece.length);
    yield piece;
  }
}

async function read(path: string): Promise<Buffer> {
  return joined(readFilePieces(path, { signal: signal() }));
}

async function manifestIn(path: string, pair: Awaited<ReturnType<typeof ownerKey>>["pair"]) {
  const opened = valueOf(await openBackup(readFilePieces(path, { signal: signal() }), pair));
  return checkArchive(openBody(opened.body, opened.dataKey, opened.frame));
}

describe("a backup file", () => {
  it("checks right after it is written, and the owner key opens every file it holds", async () => {
    const folder = await stateFolder();
    const owner = await ownerKey();
    const plan = planOf(folder, owner.publicKey);
    const backup = await written(plan);

    expect(await verifyBackup(plan.target, backup, signal())).toStrictEqual({
      ok: true,
      value: undefined,
    });
    const manifest = await manifestIn(plan.target, owner.pair);
    expect(manifest.files.map((file) => [file.path, file.bytes])).toStrictEqual([
      ["engine.sqlite", 200_000],
      ["config.json5", 14],
      ["workspace/agent/notes.md", 5],
    ]);
    expect(manifest.privy).toStrictEqual(plan.privy);
  });

  it("fails a wrong owner key at the wrapped key, before any chunk is read", async () => {
    const folder = await stateFolder();
    const plan = planOf(folder, (await ownerKey()).publicKey);
    await written(plan);
    const pulls: number[] = [];

    const opened = await openBackup(recorded(plan.target, pulls), (await ownerKey()).pair);

    expect(opened).toStrictEqual({ ok: false, error: "wrong_owner_key" });
    expect(pulls).toStrictEqual([4_096]);
  });

  it("fails its check once a byte of the body changes", async () => {
    const folder = await stateFolder();
    const plan = planOf(folder, (await ownerKey()).publicKey);
    const backup = await written(plan);
    const bytes = await read(plan.target);
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 100) ^ 1, bytes.length - 100);
    await writePrivateFile(plan.target, bytes, writing);

    expect(await verifyBackup(plan.target, backup, signal())).toStrictEqual({
      ok: false,
      error: "check_failed",
    });
  });

  it("fails when one backup's header is put on another's body", async () => {
    const folder = await stateFolder();
    const owner = await ownerKey();
    const first = planOf(folder, owner.publicKey, "first.bnfbak");
    const second = planOf(folder, owner.publicKey, "second.bnfbak");
    await written(first);
    await written(second);
    const [a, b] = [await read(first.target), await read(second.target)];
    const swapped = Buffer.concat([
      a.subarray(0, a.indexOf(0x0a) + 1),
      b.subarray(b.indexOf(0x0a) + 1),
    ]);
    await writePrivateFile(join(folder, "swapped.bnfbak"), swapped, writing);

    await expect(manifestIn(join(folder, "swapped.bnfbak"), owner.pair)).rejects.toMatchObject({
      code: "backup.damaged",
    });
  });

  it("is no backup to open when its first line is something else", async () => {
    const folder = await stateFolder();
    const owner = await ownerKey();

    const opened = await openBackup(
      readFilePieces(join(folder, "config.json5"), { signal: signal() }),
      owner.pair,
    );

    expect(opened).toStrictEqual({ ok: false, error: "not_a_backup" });
  });

  it("writes nothing for an owner key that is no p-256 public key", async () => {
    const folder = await stateFolder();
    const plan = planOf(folder, "AAAA");

    expect(await writeBackup(plan, writing)).toStrictEqual({ ok: false, error: "bad_owner_key" });
  });

  it("unpacks every file into a folder with the owner key binference holds", async () => {
    const folder = await stateFolder();
    const owner = createP256KeyPair();
    const plan = planOf(folder, owner.publicKey);
    await written(plan);
    const into = join(folder, "restored");
    const opened = valueOf(
      await openBackup(
        readFilePieces(plan.target, { signal: signal() }),
        ownerKeyRecipient(owner.privateKey),
      ),
    );

    const manifest = valueOf(await unpackBackup(opened, into, writing));

    expect(manifest.files.map((file) => file.path).toSorted()).toStrictEqual(
      await listFolderFiles(into, signal()),
    );
    expect(await read(join(into, "workspace", "agent", "notes.md"))).toStrictEqual(
      Buffer.from("notes"),
    );
    expect(opened.dataKey.every((byte) => byte === 0)).toBe(true);
  });

  it("calls a backup that does not check damaged when it unpacks", async () => {
    const folder = await stateFolder();
    const owner = createP256KeyPair();
    const plan = planOf(folder, owner.publicKey);
    await written(plan);
    const bytes = await read(plan.target);
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 20) ^ 1, bytes.length - 20);
    await writePrivateFile(plan.target, bytes, writing);
    const opened = valueOf(
      await openBackup(
        readFilePieces(plan.target, { signal: signal() }),
        ownerKeyRecipient(owner.privateKey),
      ),
    );

    expect(await unpackBackup(opened, join(folder, "restored"), writing)).toStrictEqual({
      ok: false,
      error: "damaged",
    });
  });
});
