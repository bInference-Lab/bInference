import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecret, type SecretStore } from "@binference/core";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import type { FilePermissions } from "../ports.js";
import { createPassphraseSecretStore } from "./passphrase-secret-store.js";

// A second process that writes the agent key through the passphrase store and dies the moment the
// store renames its temporary file over the old one, as a power cut or a kill would end it there.
// Node's builtin modules share their exports with the ES module bindings once
// syncBuiltinESMExports runs, so the store's own `rename` is the one replaced. Its input arrives on
// stdin, so no secret is on the command line.
const crashingWriter = `
import { writeSync } from "node:fs";
import { text } from "node:stream/consumers";
import files from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const input = JSON.parse(await text(process.stdin));
files.rename = async () => {
  writeSync(1, "renaming\\n");
  process.kill(process.pid, "SIGKILL");
  await new Promise(() => {});
};
syncBuiltinESMExports();
const { createPassphraseSecretStore } = await import(input.module);
const permissions = { restrictFolder: async () => {}, restrictFile: async () => {} };
const passphrase = { reveal: () => input.passphrase };
const store = createPassphraseSecretStore({ ...input.store, passphrase, permissions });
await store.write("agent-key", { reveal: () => input.value }, new AbortController().signal);
process.stdout.write("renamed\\n");
`;

const installId = "ins_1";
const testPassphrase = "correct horse battery staple";
const scryptCost = 1024;
const oldKey = "old agent key text";
const newKey = "new agent key text";

const folders: string[] = [];

async function keysFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(root);
  const folder = join(root, "keys");
  await mkdir(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map(async (folder) => rm(folder, { recursive: true, maxRetries: 10, retryDelay: 200 })),
  );
});

const ownerOnly: FilePermissions = {
  restrictFolder: async () => undefined,
  restrictFile: async () => undefined,
};

const storeIn = (folder: string): SecretStore =>
  createPassphraseSecretStore({
    folder,
    installId,
    passphrase: createSecret(testPassphrase),
    permissions: ownerOnly,
    scryptCost,
  });

const signal = (): AbortSignal => new AbortController().signal;

async function heldIn(folder: string): Promise<string> {
  const read = await storeIn(folder).read("agent-key", signal());
  return read.ok ? read.value.reveal() : read.error;
}

async function crashWhileWriting(folder: string) {
  const input = JSON.stringify({
    module: new URL("passphrase-secret-store.ts", import.meta.url).href,
    store: { folder, installId, scryptCost },
    passphrase: testPassphrase,
    value: newKey,
  });
  return execa(
    process.execPath,
    [
      "--conditions=@binference/source",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      crashingWriter,
    ],
    { input, reject: false, shell: false, cancelSignal: AbortSignal.timeout(50_000) },
  );
}

describe("the agent-key file when a write is cut off", () => {
  it("keeps the old file whole when the process dies between the synced temporary file and the rename", async () => {
    const folder = await keysFolder();
    await storeIn(folder).write("agent-key", createSecret(oldKey), signal());
    const before = await readFile(join(folder, "agent-key.json"));

    const crash = await crashWhileWriting(folder);

    expect({ failed: crash.failed, stdout: crash.stdout }).toStrictEqual({
      failed: true,
      stdout: "renaming",
    });
    await expect(readFile(join(folder, "agent-key.json"))).resolves.toStrictEqual(before);
    await expect(heldIn(folder)).resolves.toBe(oldKey);

    // The new data was whole and synced in the temporary file when the process died.
    const left = (await readdir(folder)).filter((name) => name.endsWith(".tmp"));
    expect(left).toHaveLength(1);
    const elsewhere = await keysFolder();
    await Promise.all(
      left.map(async (name) => copyFile(join(folder, name), join(elsewhere, "agent-key.json"))),
    );
    await expect(heldIn(elsewhere)).resolves.toBe(newKey);

    // The next write replaces the old key as usual.
    await storeIn(folder).write("agent-key", createSecret(newKey), signal());
    await expect(heldIn(folder)).resolves.toBe(newKey);
  }, 60_000);
});
