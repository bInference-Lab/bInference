import { realpathSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempFolder, type TempFolder } from "./fakes/temp-folder.js";
import { realPathOf } from "./read-file-bytes.js";
import { type RealPathStep, readJudgedFile } from "./read-judged-file.js";

const live = (): AbortSignal => new AbortController().signal;
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

// Between the open and the real path: the path made a plain file the judge would accept.
const swapForPlainFile: RealPathStep = async (path, signal) => {
  await rm(path);
  await writeFile(path, "plain");
  return realPathOf(path, signal);
};

// Between the open and the real path: the file removed.
const removeFile: RealPathStep = async (path, signal) => {
  await rm(path);
  return realPathOf(path, signal);
};

describe("reading a file through the handle that was judged", () => {
  let temp: TempFolder;
  // The temporary folder as the OS resolves it, with a protected folder and an open one in it.
  let root: string;
  let secret: string;
  beforeEach(async () => {
    temp = await createTempFolder("judged-read-");
    root = realpathSync(temp.path);
    await mkdir(join(root, "protected"));
    await mkdir(join(root, "open"));
    secret = join(root, "protected", "agent-key");
    await writeFile(secret, "secret");
    await writeFile(join(root, "open", "note.txt"), "hello");
  });
  afterEach(async () => {
    await temp.remove();
  });

  const judge = (realPath: string): "walled" | undefined =>
    realPath.startsWith(`${join(root, "protected")}${sep}`) ? "walled" : undefined;
  const read = async (path: string, more: { realPath?: RealPathStep; maxBytes?: number } = {}) =>
    readJudgedFile(path, { maxBytes: 100, signal: live(), judge, ...more });

  it("reads a file and a link to one, answering the real path each was read at", async () => {
    const note = join(root, "open", "note.txt");
    await symlink(note, join(root, "open", "pointer.txt"));
    expect([await read(note), await read(join(root, "open", "pointer.txt"))]).toStrictEqual([
      { kind: "read", realPath: note, bytes: bytesOf("hello") },
      { kind: "read", realPath: note, bytes: bytesOf("hello") },
    ]);
  });

  it("refuses a real path its judge refuses, before it tells the file's size", async () => {
    await symlink(secret, join(root, "open", "innocent.txt"));
    expect(await read(join(root, "open", "innocent.txt"), { maxBytes: 1 })).toStrictEqual({
      kind: "refused",
      refusal: "walled",
    });
  });

  it("answers changed when the path names another file once the file is open", async () => {
    // At the open the path leads to the secret; by the time its real path is found it is a
    // plain file the judge accepts, so only the handle's identity catches the move.
    const path = join(root, "open", "swapped.txt");
    await symlink(secret, path);
    expect(await read(path, { realPath: swapForPlainFile })).toStrictEqual({ kind: "changed" });
  });

  it("answers changed when the file is gone once it is open", async () => {
    const path = join(root, "open", "note.txt");
    expect(await read(path, { realPath: removeFile })).toStrictEqual({ kind: "changed" });
  });

  it("answers a folder, a file over the limit and nothing there", async () => {
    const reads = [
      await read(join(root, "open")),
      await read(join(root, "open", "note.txt"), { maxBytes: 4 }),
      await read(join(root, "open", "gone.txt")),
    ];
    expect(reads).toStrictEqual([
      { kind: "is_folder" },
      { kind: "too_large" },
      { kind: "not_found" },
    ]);
  });

  it("rejects with the signal's reason once it aborts", async () => {
    const stopped = new Error("stopped");
    const stop = new AbortController();
    stop.abort(stopped);
    await expect(
      readJudgedFile(join(root, "open", "note.txt"), { maxBytes: 9, signal: stop.signal, judge }),
    ).rejects.toBe(stopped);
  });
});
