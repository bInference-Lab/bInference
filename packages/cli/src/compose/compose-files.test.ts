import { join } from "node:path";
import { machineFilesContract } from "@binference/engine/testing";
import { ensurePrivateFolder, realFilePath, writePrivateFile } from "@binference/platform";
import { createFileLink, createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { machineFilesOf } from "./compose-files.js";

const folders: TempFolder[] = [];
const permissions = {
  restrictFolder: async () => Promise.resolve(),
  restrictFile: async () => Promise.resolve(),
  syncFolder: async () => Promise.resolve(),
};
const signal = new AbortController().signal;
const setUp = { permissions, signal };
const call = { signal, workspaceOnly: false };

// A home folder with a note, and binference's state folder inside it with a key and a workspace.
async function machine() {
  const folder = await createTempFolder("files-");
  folders.push(folder);
  const home = await realFilePath(folder.path, signal);
  const state = join(home, ".binference");
  const workspace = join(state, "workspace");
  await ensurePrivateFolder(join(state, "keys"), setUp);
  await ensurePrivateFolder(workspace, setUp);
  await ensurePrivateFolder(join(home, "pictures"), setUp);
  await writePrivateFile(join(home, "notes.txt"), "hello", setUp);
  await writePrivateFile(join(state, "keys", "agent-key"), "secret", setUp);
  const files = machineFilesOf({
    walled: { roots: [state], open: [workspace] },
    workspace,
    homeDir: home,
  });
  return { home, state, workspace, files };
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe("the agent's files on this machine", () => {
  it.each(
    machineFilesContract({
      create: async () => {
        const { files, workspace } = await machine();
        return {
          files,
          workspace,
          outside: { path: "~/notes.txt", text: "hello" },
          walled: "~/.binference/keys/agent-key",
          folder: "~/pictures",
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a link that leads into binference's folder, for a read and a write", async () => {
    const { home, state, files } = await machine();
    await createFileLink(join(state, "keys", "agent-key"), join(home, "innocent.txt"));
    await createFileLink(join(state, "keys"), join(home, "door"));
    expect(await files.read("~/innocent.txt", { ...call, maxBytes: 100 })).toStrictEqual({
      ok: false,
      error: "walled",
    });
    expect(await files.write("~/door/new-key", new Uint8Array([1]), call)).toStrictEqual({
      ok: false,
      error: "walled",
    });
  });

  it("removes a link itself, leaving what it leads to", async () => {
    const { home, files } = await machine();
    await createFileLink(join(home, "notes.txt"), join(home, "pointer.txt"));
    expect(await files.remove("~/pointer.txt", call)).toStrictEqual({
      ok: true,
      value: join(home, "pointer.txt"),
    });
    expect(await files.read("~/notes.txt", { ...call, maxBytes: 100 })).toMatchObject({ ok: true });
  });
});
