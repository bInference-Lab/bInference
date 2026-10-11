import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import {
  ensurePrivateFolder,
  listFolderFiles,
  readTextFile,
  resolveStateFolder,
  type StateFolder,
  movePath,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { type MovePath, pruneReplaced, swapInRestored } from "./state-swap.js";

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

// A rename that fails as a held file does on Windows: at the moves whose numbers `failing` names,
// counted from 1 across the swap and its reversal.
function faultyMove(failing: readonly number[]): {
  readonly move: MovePath;
  readonly count: () => number;
} {
  let count = 0;
  const move: MovePath = async (from, to, moveSignal) => {
    count += 1;
    if (failing.includes(count)) {
      throw new BinferenceError({ code: "platform.move_failed", message: "Held open." });
    }
    return movePath(from, to, moveSignal);
  };
  return { move, count: () => count };
}

const before = [
  "engine.sqlite",
  "engine.sqlite-wal",
  "agent.sqlite",
  "config.json5",
  "workspace/agent/notes.md",
  "keys/agent-key",
];
const staged = ["engine.sqlite", "agent.sqlite", "config.json5", "workspace/agent/new.md"];

describe("a swap that fails part way", () => {
  // 8 renames aside, then 8 in, one per name, tried whether or not the file is there: a fault at
  // each.
  it.each(Array.from({ length: 16 }, (_, index) => index + 1))(
    "puts every file back when move %i fails",
    async (failing) => {
      const state = await stateWith(before);
      const from = await restoredWith(state, staged);
      const listed = await listFolderFiles(state.root, signal());
      const faulty = faultyMove([failing]);

      const swapping = swapInRestored(state, from, { ...files, atMs, move: faulty.move });

      await expect(swapping).rejects.toMatchObject({ code: "platform.move_failed" });
      expect(await listFolderFiles(state.root, signal())).toStrictEqual(listed);
      expect(await textAt(state.engineDatabase)).toBe("old engine.sqlite");
      expect(await textAt(join(from, "engine.sqlite"))).toBe("new engine.sqlite");
    },
  );

  it("keeps both folders and names them when a move back fails too", async () => {
    const state = await stateWith(before);
    const from = await restoredWith(state, staged);
    // The 12th rename, the restored agent.sqlite, fails; then the first move back fails.
    const faulty = faultyMove([12, 13]);

    const swapping = swapInRestored(state, from, { ...files, atMs, move: faulty.move });

    const aside = join(state.root, "replaced", "20261012-033015");
    await expect(swapping).rejects.toMatchObject({
      code: "backup.restore_rollback_failed",
      details: { aside, staged: from },
    });
    // The restored engine.sqlite could not go back, so the old one waits aside.
    expect(await textAt(state.engineDatabase)).toBe("new engine.sqlite");
    expect(await textAt(join(aside, "engine.sqlite"))).toBe("old engine.sqlite");
    expect(await textAt(join(state.root, "config.json5"))).toBe("old config.json5");
  });

  it("names both folders when an undo cannot move a file back", async () => {
    const state = await stateWith(before);
    const from = await restoredWith(state, staged);
    // 16 renames swap, 9 of them move a file; the undo's first move back, the workspace, fails.
    const faulty = faultyMove([17]);
    const swap = await swapInRestored(state, from, { ...files, atMs, move: faulty.move });

    await expect(swap.undo()).rejects.toMatchObject({ code: "backup.restore_rollback_failed" });
    // The old workspace never moves onto the path the restored one still holds.
    expect(faulty.count()).toBe(24);
    const aside = join(state.root, "replaced", "20261012-033015");
    expect(await textAt(join(aside, "workspace", "agent", "notes.md"))).toBe(
      "old workspace/agent/notes.md",
    );
    expect(await textAt(state.engineDatabase)).toBe("old engine.sqlite");
    expect(await textAt(join(state.root, "workspace", "agent", "new.md"))).toBe(
      "new workspace/agent/new.md",
    );
  });
});
