import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempFolder, type TempFolder } from "./fakes/temp-folder.js";
import { readFileBytes, realPathOf } from "./read-file-bytes.js";
import { runCommandToExit } from "./run-command.js";

const live = (): AbortSignal => new AbortController().signal;

describe("reading a file's bytes", () => {
  let temp: TempFolder;
  beforeEach(async () => {
    temp = await createTempFolder("file-bytes-");
  });
  afterEach(async () => {
    await temp.remove();
  });

  it("reads a file whole, refuses one over the limit, a folder and nothing at all", async () => {
    const file = join(temp.path, "chart.png");
    await writeFile(file, Uint8Array.from([1, 2, 3]));
    await mkdir(join(temp.path, "folder"));
    const reads = await Promise.all([
      readFileBytes(file, { maxBytes: 3, signal: live() }),
      readFileBytes(file, { maxBytes: 2, signal: live() }),
      readFileBytes(join(temp.path, "folder"), { maxBytes: 3, signal: live() }),
      readFileBytes(join(temp.path, "gone"), { maxBytes: 3, signal: live() }),
    ]);
    expect(reads).toStrictEqual([
      { ok: true, value: Uint8Array.from([1, 2, 3]) },
      { ok: false, error: "too_large" },
      { ok: false, error: "unreadable" },
      { ok: false, error: "not_found" },
    ]);
  });

  it("gives a link's real path, and none for nothing", async () => {
    const file = join(temp.path, "real.png");
    await writeFile(file, "x");
    const link = join(temp.path, "link.png");
    await symlink(file, link);
    expect(await realPathOf(link, live())).toBe(await realPathOf(file, live()));
    expect(await realPathOf(join(temp.path, "gone"), live())).toBeUndefined();
  });

  // A blocking open of a pipe with no writer would hold the read, and this test, until it timed out.
  it.skipIf(process.platform === "win32")("refuses a named pipe at once", async () => {
    const pipe = join(temp.path, "pipe");
    await runCommandToExit("mkfifo", [pipe], live());
    expect(await readFileBytes(pipe, { maxBytes: 3, signal: live() })).toStrictEqual({
      ok: false,
      error: "unreadable",
    });
  });
});
