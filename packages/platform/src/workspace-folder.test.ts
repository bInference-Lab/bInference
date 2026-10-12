import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { workspaceFilesContract } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createTempFolder, type TempFolder } from "./fakes/temp-folder.js";
import { createPosixFilePermissions } from "./posix/posix-file-permissions.js";
import { createWin32FilePermissions } from "./win32/win32-file-permissions.js";
import { createWorkspaceFolder } from "./workspace-folder.js";

const folders: TempFolder[] = [];
const permissions =
  process.platform === "win32" ? createWin32FilePermissions() : createPosixFilePermissions();
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";

async function workspace() {
  const folder = await createTempFolder("bnf-ws-");
  folders.push(folder);
  return { root: folder.path, files: createWorkspaceFolder({ root: folder.path, permissions }) };
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe("the workspace folder", () => {
  it.each(workspaceFilesContract({ create: async () => (await workspace()).files }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps each agent's files in an owner-only folder named by its id, with no draft left",
    async () => {
      const { root, files } = await workspace();
      await files.create({ agent, file: "RULES.md" }, "rules", new AbortController().signal);
      const folder = await stat(join(root, agent));
      expect(folder.mode & 0o777).toBe(0o700);
      expect((await stat(join(root, agent, "RULES.md"))).mode & 0o777).toBe(0o600);
      expect(await readdir(join(root, agent))).toStrictEqual(["RULES.md"]);
    },
  );
});
