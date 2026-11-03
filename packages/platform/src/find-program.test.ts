import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProgram } from "./find-program.js";

const isWindows = process.platform === "win32";
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

// A folder holding one program named `tool`: a `.cmd` file on Windows, an executable elsewhere.
async function folderWithTool(): Promise<{ readonly folder: string; readonly tool: string }> {
  const folder = await mkdtemp(join(tmpdir(), "binference-find-"));
  folders.push(folder);
  const tool = join(folder, isWindows ? "tool.cmd" : "tool");
  await writeFile(tool, isWindows ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { folder, tool };
}

describe("findProgram", () => {
  it("finds a program on the PATH given, spelled as Windows may spell it", async () => {
    const { folder, tool } = await folderWithTool();
    await expect(findProgram("tool", { PATH: folder })).resolves.toBe(tool);
    await expect(findProgram("tool", { Path: folder })).resolves.toBe(tool);
  });

  it("never looks on this process's PATH", async () => {
    await expect(findProgram("node", {})).resolves.toBeUndefined();
    await expect(findProgram("tool", { PATH: tmpdir() })).resolves.toBeUndefined();
  });
});
