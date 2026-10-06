import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTextFile } from "./read-text-file.js";

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

describe("read text file", () => {
  it("returns the text of a file, byte order mark and line endings kept", async () => {
    const file = join(await scratchFolder(), "config.json5");
    await writeFile(file, "﻿{ version: 1 }\r\n");
    await expect(readTextFile(file, signal())).resolves.toStrictEqual({
      ok: true,
      value: "﻿{ version: 1 }\r\n",
    });
  });

  it("answers not_found for a path where nothing exists", async () => {
    const folder = await scratchFolder();
    await expect(readTextFile(join(folder, "missing.json5"), signal())).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("names the path of a folder it cannot read as a file", async () => {
    const folder = await scratchFolder();
    await expect(readTextFile(folder, signal())).rejects.toMatchObject({
      code: "platform.file_read_failed",
      details: { path: folder },
    });
  });

  it("refuses a file over 1 MiB", async () => {
    const file = join(await scratchFolder(), "big.json5");
    await writeFile(file, "x".repeat(1_048_577));
    await expect(readTextFile(file, signal())).rejects.toMatchObject({
      code: "platform.file_too_large",
    });
  });

  it("reads nothing on an aborted signal", async () => {
    const reason = new Error("stopped");
    await expect(readTextFile("anything", AbortSignal.abort(reason))).rejects.toBe(reason);
  });
});
