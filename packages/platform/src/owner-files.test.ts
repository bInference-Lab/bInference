import { chmod, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempFolder, type TempFolder } from "./fakes/temp-folder.js";
import { removeOwnerFile, writeOwnerFile } from "./owner-files.js";

const folders: TempFolder[] = [];
const signal = new AbortController().signal;
const bytes = (text: string) => new TextEncoder().encode(text);

async function folder(): Promise<string> {
  const made = await createTempFolder("owner-");
  folders.push(made);
  return made.path;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (each) => each.remove()));
});

describe("writeOwnerFile", () => {
  it("writes a file in folders it makes, and replaces one keeping its mode", async () => {
    const root = await folder();
    const path = join(root, "a", "b", "c.md");
    expect(await writeOwnerFile(path, bytes("one"), { signal })).toStrictEqual({
      ok: true,
      value: undefined,
    });
    await chmod(path, 0o600);
    expect(await writeOwnerFile(path, bytes("two"), { signal })).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(await readFile(path, "utf8")).toBe("two");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("refuses to create over a file, and to write a folder", async () => {
    const root = await folder();
    await writeFile(join(root, "a.md"), "x");
    await mkdir(join(root, "dir"));
    expect(
      await writeOwnerFile(join(root, "a.md"), bytes("y"), { signal, createOnly: true }),
    ).toStrictEqual({ ok: false, error: "exists" });
    expect(await writeOwnerFile(join(root, "dir"), bytes("y"), { signal })).toStrictEqual({
      ok: false,
      error: "is_folder",
    });
    expect(
      await writeOwnerFile(join(root, "new.md"), bytes("z"), { signal, createOnly: true }),
    ).toStrictEqual({ ok: true, value: undefined });
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("x");
  });

  it("answers unwritable when its folder cannot be made", async () => {
    const root = await folder();
    await writeFile(join(root, "file"), "x");
    expect(
      await writeOwnerFile(join(root, "file", "inner.md"), bytes("y"), { signal }),
    ).toStrictEqual({ ok: false, error: "unwritable" });
  });
});

describe("removeOwnerFile", () => {
  it("removes a file, a link itself and never a folder", async () => {
    const root = await folder();
    await writeFile(join(root, "a.md"), "x");
    await symlink(join(root, "a.md"), join(root, "link.md"));
    await mkdir(join(root, "dir"));
    expect(await removeOwnerFile(join(root, "link.md"), signal)).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("x");
    expect(await removeOwnerFile(join(root, "a.md"), signal)).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(await removeOwnerFile(join(root, "a.md"), signal)).toStrictEqual({
      ok: false,
      error: "not_found",
    });
    expect(await removeOwnerFile(join(root, "dir"), signal)).toStrictEqual({
      ok: false,
      error: "is_folder",
    });
  });
});
