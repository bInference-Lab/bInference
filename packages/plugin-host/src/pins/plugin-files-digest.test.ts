// oxlint-disable-next-line eslint/no-restricted-imports -- the test writes a plugin's folder
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPluginFiles, digestOfFiles, pluginFilesDigest } from "./plugin-files-digest.js";

const folders: string[] = [];
const signal = AbortSignal.timeout(30_000);
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

async function pluginFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-pin-"));
  folders.push(folder);
  await mkdir(join(folder, "dist"));
  await writeFile(join(folder, "package.json"), "{}");
  await writeFile(join(folder, "dist", "index.mjs"), "export const tools = {};");
  return folder;
}

const files = [
  { path: "package.json", bytes: bytes("{}") },
  { path: "dist/index.mjs", bytes: bytes("export const tools = {};") },
];

describe("a plugin's files digest", () => {
  it("is the same whatever order the files come in", () => {
    expect(digestOfFiles(files)).toBe(digestOfFiles(files.toReversed()));
    expect(digestOfFiles(files)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a path moves, even with the same bytes", () => {
    const moved = [
      { path: "package.json", bytes: bytes("{}") },
      { path: "dist/main.mjs", bytes: bytes("export const tools = {};") },
    ];

    expect(digestOfFiles(moved)).not.toBe(digestOfFiles(files));
  });

  it("hashes the lines of each path and its bytes' SHA-256", () => {
    expect(pluginFilesDigest([])).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("checking a plugin's installed folder against its pin", () => {
  it("passes the folder its pin was made from", async () => {
    const folder = await pluginFolder();

    await expect(checkPluginFiles(folder, digestOfFiles(files), signal)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
  });

  it("refuses a folder with a file added or changed, and one that is gone", async () => {
    const folder = await pluginFolder();
    await writeFile(join(folder, "dist", "extra.mjs"), "");

    await expect(checkPluginFiles(folder, digestOfFiles(files), signal)).resolves.toStrictEqual({
      ok: false,
      error: "files_changed",
    });
    await expect(
      checkPluginFiles(join(folder, "gone"), digestOfFiles(files), signal),
    ).resolves.toStrictEqual({ ok: false, error: "files_changed" });
  });
});
