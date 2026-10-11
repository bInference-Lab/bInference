import { join } from "node:path";
import {
  ensurePrivateFolder,
  listFolderFiles,
  readTextFile,
  resolveStateFolder,
  type StateFolder,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { pruneReplaced, swapInRestored } from "./state-swap.js";

const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;
const files = { permissions: noPermissions, signal: signal() };
const atMs = Date.parse("2026-10-12T03:30:15Z");
const dayMs = 86_400_000;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function write(path: string, text: string): Promise<void> {
  await ensurePrivateFolder(join(path, ".."), files);
  await writePrivateFile(path, text, files);
}

async function stateWith(names: readonly string[]): Promise<StateFolder> {
  const folder = await createTempFolder("bnf-swap-");
  folders.push(folder);
  const state = resolveStateFolder({ binferenceHome: folder.path });
  await Promise.all(
    names.map(async (name) => write(join(state.root, ...name.split("/")), `old ${name}`)),
  );
  return state;
}

async function restoredWith(state: StateFolder, names: readonly string[]): Promise<string> {
  const from = join(state.root, ".restoring");
  await Promise.all(
    names.map(async (name) => write(join(from, ...name.split("/")), `new ${name}`)),
  );
  return from;
}

async function textAt(path: string): Promise<string | undefined> {
  const read = await readTextFile(path, signal());
  return read.ok ? read.value : undefined;
}

describe("putting a restored state in place", () => {
  it("moves the state it replaces aside, keeps keys and backups, and can undo both moves", async () => {
    const state = await stateWith([
      "engine.sqlite",
      "engine.sqlite-wal",
      "config.json5",
      "workspace/agent/notes.md",
      "keys/agent-key",
      "backups/one.bnfbak",
    ]);
    const from = await restoredWith(state, [
      "engine.sqlite",
      "config.json5",
      "workspace/agent/new.md",
    ]);

    const swap = await swapInRestored(state, from, { ...files, atMs });

    expect(swap.aside).toBe(join(state.root, "replaced", "20261012-033015"));
    expect(await listFolderFiles(state.root, signal())).toStrictEqual([
      "backups/one.bnfbak",
      "config.json5",
      "engine.sqlite",
      "keys/agent-key",
      "replaced/20261012-033015/config.json5",
      "replaced/20261012-033015/engine.sqlite",
      "replaced/20261012-033015/engine.sqlite-wal",
      "replaced/20261012-033015/workspace/agent/notes.md",
      "workspace/agent/new.md",
    ]);
    expect(await textAt(state.engineDatabase)).toBe("new engine.sqlite");

    await swap.undo();

    expect(await listFolderFiles(state.root, signal())).toStrictEqual([
      ".restoring/config.json5",
      ".restoring/engine.sqlite",
      ".restoring/workspace/agent/new.md",
      "backups/one.bnfbak",
      "config.json5",
      "engine.sqlite",
      "engine.sqlite-wal",
      "keys/agent-key",
      "workspace/agent/notes.md",
    ]);
    expect(await textAt(state.engineDatabase)).toBe("old engine.sqlite");
  });

  it("sets nothing aside on a folder that held no state", async () => {
    const state = await stateWith([]);
    const from = await restoredWith(state, ["engine.sqlite"]);

    const swap = await swapInRestored(state, from, { ...files, atMs });

    expect(swap.aside).toBeUndefined();
    expect(await listFolderFiles(state.root, signal())).toStrictEqual(["engine.sqlite"]);
  });

  it("removes a state set aside once it is 7 days old, and nothing younger", async () => {
    const state = await stateWith(["engine.sqlite"]);
    await swapInRestored(state, await restoredWith(state, ["engine.sqlite"]), { ...files, atMs });
    await write(join(state.root, "replaced", "not-a-time", "file"), "kept");

    await pruneReplaced(state, atMs + 7 * dayMs - 1, signal());
    const young = await listFolderFiles(join(state.root, "replaced"), signal());
    await pruneReplaced(state, atMs + 7 * dayMs, signal());

    expect(young).toStrictEqual(["20261012-033015/engine.sqlite", "not-a-time/file"]);
    expect(await listFolderFiles(join(state.root, "replaced"), signal())).toStrictEqual([
      "not-a-time/file",
    ]);
  });
});
