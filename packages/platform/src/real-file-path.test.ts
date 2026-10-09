import { mkdtemp, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realFilePath } from "./real-file-path.js";

const folders: string[] = [];
const live = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

describe("real file path", () => {
  it("resolves a link to the folder that holds the file", async () => {
    const folder = await realpath(await mkdtemp(join(tmpdir(), "bnf-")));
    folders.push(folder);
    await writeFile(join(folder, "program.mjs"), "");
    await symlink(folder, join(folder, "linked"), "junction");
    await expect(realFilePath(join(folder, "linked", "program.mjs"), live())).resolves.toBe(
      join(folder, "program.mjs"),
    );
  });

  it("names the fault when nothing is at the path", async () => {
    await expect(
      realFilePath(join(tmpdir(), "bnf-missing", "program.mjs"), live()),
    ).rejects.toMatchObject({ code: "platform.path_unresolved" });
  });
});
