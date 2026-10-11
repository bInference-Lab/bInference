import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileSize } from "./file-size.js";
import { listFolderFiles } from "./list-folder-files.js";
import { movePath, removePath } from "./move-path.js";

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

describe("listing a folder's files", () => {
  it("lists every file at any depth with forward slashes, sorted, and no folders", async () => {
    const folder = await scratchFolder();
    await mkdir(join(folder, "agent", "skills"), { recursive: true });
    await mkdir(join(folder, "empty"));
    await writeFile(join(folder, "agent", "skills", "b.md"), "b");
    await writeFile(join(folder, "agent", "a.md"), "a");
    await writeFile(join(folder, "top.md"), "t");

    expect(await listFolderFiles(folder, signal())).toStrictEqual([
      "agent/a.md",
      "agent/skills/b.md",
      "top.md",
    ]);
  });

  it("lists nothing for a folder that is not there", async () => {
    expect(await listFolderFiles(join(await scratchFolder(), "missing"), signal())).toStrictEqual(
      [],
    );
  });

  it.skipIf(process.platform === "win32")("never lists or follows a link", async () => {
    const folder = await scratchFolder();
    const outside = await scratchFolder();
    await writeFile(join(outside, "secret"), "s");
    await symlink(outside, join(folder, "linked"));
    await symlink(join(outside, "secret"), join(folder, "file-link"));

    expect(await listFolderFiles(folder, signal())).toStrictEqual([]);
  });
});

describe("moving and removing paths", () => {
  it("moves a folder in one step and removes it with what it holds", async () => {
    const folder = await scratchFolder();
    await mkdir(join(folder, "from"));
    await writeFile(join(folder, "from", "file"), "x");

    expect(await movePath(join(folder, "from"), join(folder, "to"), signal())).toStrictEqual({
      ok: true,
      value: undefined,
    });

    expect(await fileSize(join(folder, "to", "file"), signal())).toStrictEqual({
      ok: true,
      value: 1,
    });
    await removePath(join(folder, "to"), signal());
    await removePath(join(folder, "never"), signal());
    expect(await listFolderFiles(folder, signal())).toStrictEqual([]);
  });

  it("moves nothing when the path is not there, and names the fault when the target's folder is not", async () => {
    const folder = await scratchFolder();
    await mkdir(join(folder, "from"));

    expect(await movePath(join(folder, "missing"), join(folder, "to"), signal())).toStrictEqual({
      ok: false,
      error: "not_found",
    });
    await expect(
      movePath(join(folder, "from"), join(folder, "no", "to"), signal()),
    ).rejects.toMatchObject({ code: "platform.move_failed" });
  });
});
