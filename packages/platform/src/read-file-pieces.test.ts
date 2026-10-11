import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileSize } from "./file-size.js";
import { readFilePieces } from "./read-file-pieces.js";

const folders: string[] = [];

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

const signal = (): AbortSignal => new AbortController().signal;

async function piecesOf(path: string, pieceBytes: number): Promise<readonly number[][]> {
  const read: number[][] = [];
  for await (const piece of readFilePieces(path, { pieceBytes, signal: signal() })) {
    read.push([...piece]);
  }
  return read;
}

describe("reading a file in pieces", () => {
  it("gives full pieces, then the rest", async () => {
    const file = join(await scratchFolder(), "data");
    await writeFile(file, Buffer.from([1, 2, 3, 4, 5]));

    expect(await piecesOf(file, 2)).toStrictEqual([[1, 2], [3, 4], [5]]);
    expect(await piecesOf(file, 5)).toStrictEqual([[1, 2, 3, 4, 5]]);
  });

  it("gives nothing for an empty file", async () => {
    const file = join(await scratchFolder(), "empty");
    await writeFile(file, Buffer.alloc(0));

    expect(await piecesOf(file, 4)).toStrictEqual([]);
  });

  it("names the fault for a file that is not there", async () => {
    const file = join(await scratchFolder(), "missing");

    await expect(piecesOf(file, 4)).rejects.toMatchObject({ code: "platform.file_read_failed" });
  });

  it("stops on an aborted signal", async () => {
    const file = join(await scratchFolder(), "data");
    await writeFile(file, Buffer.from([1]));
    const reason = new Error("stopped");
    const pieces = readFilePieces(file, { signal: AbortSignal.abort(reason) });

    await expect(pieces.next()).rejects.toBe(reason);
  });
});

describe("a file's size", () => {
  it("reads the size of a file and answers not_found for a missing one", async () => {
    const folder = await scratchFolder();
    const file = join(folder, "data");
    await writeFile(file, Buffer.from([1, 2, 3]));

    expect(await fileSize(file, signal())).toStrictEqual({ ok: true, value: 3 });
    expect(await fileSize(join(folder, "missing"), signal())).toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("names the fault for a folder", async () => {
    const folder = await scratchFolder();

    await expect(fileSize(folder, signal())).rejects.toMatchObject({
      code: "platform.file_read_failed",
    });
  });
});
