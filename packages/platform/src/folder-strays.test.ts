import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findFolderStrays } from "./folder-strays.js";

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

describe("finding what in a folder is not a plain file", () => {
  it("finds nothing in a folder of plain files and folders", async () => {
    const folder = await scratchFolder();
    await mkdir(join(folder, "dist", "inner"), { recursive: true });
    await writeFile(join(folder, "package.json"), "{}");
    await writeFile(join(folder, "dist", "inner", "index.mjs"), "export {};");

    expect(await findFolderStrays(folder, signal())).toStrictEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "finds a link to a file and to a folder at any depth, and never follows one",
    async () => {
      const folder = await scratchFolder();
      const outside = await scratchFolder();
      await writeFile(join(outside, "secret"), "s");
      await mkdir(join(folder, "dist"));
      await symlink(join(outside, "secret"), join(folder, "dist", "file-link"));
      await symlink(outside, join(folder, "folder-link"));

      expect(await findFolderStrays(folder, signal())).toStrictEqual([
        "dist/file-link",
        "folder-link",
      ]);
    },
  );

  it("finds a file that has a second hard link outside the folder", async () => {
    const folder = await scratchFolder();
    const outside = await scratchFolder();
    await writeFile(join(outside, "shared"), "x");
    await link(join(outside, "shared"), join(folder, "index.mjs"));

    expect(await findFolderStrays(folder, signal())).toStrictEqual(["index.mjs"]);
  });

  it("refuses a folder that is not there", async () => {
    const missing = join(await scratchFolder(), "missing");

    await expect(findFolderStrays(missing, signal())).rejects.toMatchObject({
      code: "platform.folder_read_failed",
    });
  });
});
