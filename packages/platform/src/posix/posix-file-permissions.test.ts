import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { filePermissionsContract } from "../contracts/file-permissions-contract.js";
import { ensurePrivateFolder, writePrivateFile } from "../private-files.js";
import { createPosixFilePermissions } from "./posix-file-permissions.js";

const folders: string[] = [];

async function scratchFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return folder;
}

// Another account can read a path only through the group and other bits, or by owning it.
async function accessProblems(path: string): Promise<readonly string[]> {
  const info = await stat(path);
  const mode = info.mode & 0o777;
  return [
    ...((mode & 0o077) === 0 ? [] : [`mode ${mode.toString(8)} lets the group or others in`]),
    ...(info.uid === process.getuid?.() ? [] : [`owned by uid ${String(info.uid)}`]),
  ];
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

describe.skipIf(process.platform === "win32")("posix file permissions", () => {
  it.each(
    filePermissionsContract({
      create: async () => ({
        permissions: createPosixFilePermissions(),
        folder: await scratchFolder(),
      }),
      accessProblems,
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("writes a file another user cannot read, over an older file anyone could", async () => {
    const permissions = createPosixFilePermissions();
    const folder = join(await scratchFolder(), "state");
    const file = join(folder, "config.json5");
    const signal = new AbortController().signal;
    await mkdir(folder, { mode: 0o755 });
    await writeFile(file, "old", { mode: 0o644 });
    await chmod(file, 0o644);

    await ensurePrivateFolder(folder, { permissions, signal });
    await writePrivateFile(file, "{ engine: {} }", { permissions, signal });

    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await expect(accessProblems(file)).resolves.toStrictEqual([]);
    await expect(readFile(file, "utf8")).resolves.toBe("{ engine: {} }");
  });

  it("creates missing parent folders owner-only", async () => {
    const permissions = createPosixFilePermissions();
    const root = await scratchFolder();
    const folder = join(root, "home", "keys");

    await ensurePrivateFolder(folder, { permissions, signal: new AbortController().signal });

    expect((await stat(join(root, "home"))).mode & 0o777).toBe(0o700);
    expect((await stat(folder)).mode & 0o777).toBe(0o700);
  });
});
