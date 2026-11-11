import { join } from "node:path";
import { machineFilesContract } from "@binference/engine/testing";
import {
  ensurePrivateFolder,
  type RealPathStep,
  realFilePath,
  realPathOf,
  removePath,
  writePrivateFile,
} from "@binference/platform";
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
  const parts = { walled: { roots: [state], open: [workspace] }, workspace, homeDir: home };
  return { home, state, workspace, parts, files: machineFilesOf(parts) };
}

// The platform's real-path step, but `path` moves: once the check's look at it has its answer,
// and again before the next look, the one after the open, answers.
function movingStep(
  path: string,
  moves: {
    readonly afterCheck: () => Promise<void>;
    readonly beforeNextLook?: () => Promise<void>;
  },
): RealPathStep {
  let looks = 0;
  return async (asked, stepSignal) => {
    if (asked !== path) {
      return realPathOf(asked, stepSignal);
    }
    looks += 1;
    if (looks === 2) {
      await moves.beforeNextLook?.();
    }
    const real = await realPathOf(asked, stepSignal);
    if (looks === 1) {
      await moves.afterCheck();
    }
    return real;
  };
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

  it("reads a file and a link to one in the workspace, each at its real path", async () => {
    const { workspace, files } = await machine();
    await writePrivateFile(join(workspace, "plan.md"), "# Plan", setUp);
    await createFileLink(join(workspace, "plan.md"), join(workspace, "pointer.md"));
    const read = { ...call, maxBytes: 100 };
    const plan = { path: join(workspace, "plan.md"), bytes: new TextEncoder().encode("# Plan") };
    expect([await files.read("plan.md", read), await files.read("pointer.md", read)]).toStrictEqual(
      [
        { ok: true, value: plan },
        { ok: true, value: plan },
      ],
    );
  });

  it("refuses a path that leads into binference's folder by the time it is opened", async () => {
    const { state, workspace, parts } = await machine();
    const path = join(workspace, "swapped.md");
    await writePrivateFile(path, "plain", setUp);
    const toSecret = async () => {
      await removePath(path, signal);
      await createFileLink(join(state, "keys", "agent-key"), path);
    };
    const files = machineFilesOf({
      ...parts,
      realPath: movingStep(path, { afterCheck: toSecret }),
    });
    expect(await files.read("swapped.md", { ...call, maxBytes: 100 })).toStrictEqual({
      ok: false,
      error: "walled",
    });
  });

  it("refuses a path that leads elsewhere once its file is open, so the agent reads again", async () => {
    const { state, workspace, parts } = await machine();
    const path = join(workspace, "swapped.md");
    await writePrivateFile(path, "plain", setUp);
    const toSecret = async () => {
      await removePath(path, signal);
      await createFileLink(join(state, "keys", "agent-key"), path);
    };
    const backToPlain = async () => {
      await removePath(path, signal);
      await writePrivateFile(path, "plain", setUp);
    };
    const moves = { afterCheck: toSecret, beforeNextLook: backToPlain };
    const files = machineFilesOf({ ...parts, realPath: movingStep(path, moves) });
    expect(await files.read("swapped.md", { ...call, maxBytes: 100 })).toStrictEqual({
      ok: false,
      error: "changed",
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

  it("reads a screenshot named with macOS's narrow space when the name is typed with a plain one", async () => {
    const { home, files } = await machine();
    const named = `Screenshot 2026-11-07 at 4.02.11${String.fromCodePoint(0x202f)}PM.png`;
    await writePrivateFile(join(home, named), "png", setUp);
    const read = await files.read("~/Screenshot 2026-11-07 at 4.02.11 PM.png", {
      ...call,
      maxBytes: 100,
    });
    expect(read).toMatchObject({ ok: true, value: { path: join(home, named) } });
    expect(await files.read("~/nothing.png", { ...call, maxBytes: 100 })).toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });
});
