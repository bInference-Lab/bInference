import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import type { FilePermissions } from "./ports.js";
import { ensurePrivateFolder, writePrivateFile } from "./private-files.js";

const folders: string[] = [];

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

// Records each restricted path with the size the file had at that moment.
function recordingPermissions(failOn?: string) {
  const restricted: { readonly path: string; readonly bytes: number }[] = [];
  const permissions: FilePermissions = {
    restrictFolder: async (path) => {
      restricted.push({ path, bytes: -1 });
      await Promise.resolve();
    },
    restrictFile: async (path) => {
      restricted.push({ path, bytes: (await stat(path)).size });
      if (failOn !== undefined) {
        throw new BinferenceError({ code: "platform.restrict_failed", message: failOn });
      }
    },
  };
  return { permissions, restricted };
}

const signal = (): AbortSignal => new AbortController().signal;

describe("private files", () => {
  it("restricts the new file while it is still empty, then moves it into place", async () => {
    const folder = await scratchFolder();
    const target = join(folder, "agent-key.json");
    const { permissions, restricted } = recordingPermissions();

    await writePrivateFile(target, new Uint8Array([1, 2, 3]), { permissions, signal: signal() });

    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.bytes).toBe(0);
    expect(restricted[0]?.path.startsWith(`${target}.`)).toBe(true);
    await expect(readFile(target)).resolves.toStrictEqual(Buffer.from([1, 2, 3]));
    await expect(readdir(folder)).resolves.toStrictEqual(["agent-key.json"]);
  });

  it("leaves the old file and no temporary file when restricting fails", async () => {
    const folder = await scratchFolder();
    const target = join(folder, "config.json5");
    await writePrivateFile(target, "old", { ...recordingPermissions(), signal: signal() });

    await expect(
      writePrivateFile(target, "new", {
        permissions: recordingPermissions("denied").permissions,
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: "platform.restrict_failed" });

    await expect(readFile(target, "utf8")).resolves.toBe("old");
    await expect(readdir(folder)).resolves.toStrictEqual(["config.json5"]);
  });

  it("names the fault when the folder is missing", async () => {
    const target = join(await scratchFolder(), "missing", "config.json5");

    await expect(
      writePrivateFile(target, "x", { ...recordingPermissions(), signal: signal() }),
    ).rejects.toMatchObject({ code: "platform.file_write_failed" });
  });

  it("writes nothing on an aborted signal", async () => {
    const folder = await scratchFolder();
    const reason = new Error("stopped");

    await expect(
      writePrivateFile(join(folder, "a"), "x", {
        ...recordingPermissions(),
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
    await expect(readdir(folder)).resolves.toStrictEqual([]);
  });

  it("restricts a folder whether it is new or was there before", async () => {
    const folder = join(await scratchFolder(), "logs");
    const { permissions, restricted } = recordingPermissions();

    await ensurePrivateFolder(folder, { permissions, signal: signal() });
    await ensurePrivateFolder(folder, { permissions, signal: signal() });

    expect(restricted.map((item) => item.path)).toStrictEqual([folder, folder]);
  });

  it("names the fault when a folder cannot be created", async () => {
    const file = join(await scratchFolder(), "file");
    await writePrivateFile(file, "x", { ...recordingPermissions(), signal: signal() });

    await expect(
      ensurePrivateFolder(join(file, "inner"), { ...recordingPermissions(), signal: signal() }),
    ).rejects.toMatchObject({ code: "platform.folder_failed" });
  });
});
