import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureReadableFolder, writeReadableFile } from "./readable-files.js";

const folders: string[] = [];
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return folder;
}

const modeOf = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

describe("files every account may read", () => {
  it("writes a file in a new folder, replacing the one there", async () => {
    const folder = join(await scratchFolder(), "packages", "fear-index");
    await ensureReadableFolder(folder, signal());
    await writeReadableFile(join(folder, "index.mjs"), new TextEncoder().encode("one"), signal());
    await writeReadableFile(join(folder, "index.mjs"), new TextEncoder().encode("two"), signal());

    expect(await readFile(join(folder, "index.mjs"), "utf8")).toBe("two");
  });

  it.skipIf(process.platform === "win32")(
    "lets every account read and only the owner change, whatever the umask",
    async () => {
      const folder = join(await scratchFolder(), "package");
      await ensureReadableFolder(folder, signal());
      await writeReadableFile(join(folder, "a.mjs"), new Uint8Array([1]), signal());

      expect(await modeOf(folder)).toBe(0o755);
      expect(await modeOf(join(folder, "a.mjs"))).toBe(0o644);
    },
  );

  it("refuses a write into a folder that is not there", async () => {
    const missing = join(await scratchFolder(), "missing", "a.mjs");

    await expect(writeReadableFile(missing, new Uint8Array([1]), signal())).rejects.toMatchObject({
      code: "platform.file_write_failed",
    });
  });
});
