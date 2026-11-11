import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandWallContract } from "../contracts/command-wall-contract.js";
import { createTempFolder, type TempFolder } from "../fakes/temp-folder.js";
import { createLinuxCommandWall } from "./linux-command-wall.js";

const folders: TempFolder[] = [];

async function scratch(): Promise<string> {
  const folder = await createTempFolder("bnf-wall-");
  folders.push(folder);
  return realpathSync(folder.path);
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// CI runs this on Linux; it is skipped elsewhere. A Linux machine without bubblewrap answers
// `none`, which the contract's no-mechanism check would cover; here bubblewrap is required.
describe.runIf(process.platform === "linux")("linux command wall", () => {
  it.each(
    commandWallContract({
      walls: true,
      create: async () => {
        const root = await scratch();
        const auth = join(root, "auth");
        await mkdir(auth);
        const deniedFile = join(auth, "cli.token");
        const deniedContent = "secret-owner-token";
        await writeFile(deniedFile, deniedContent);
        const openFolder = join(root, "workspace");
        await mkdir(openFolder);
        const allowedFile = join(await scratch(), "ok.txt");
        const allowedContent = "readable";
        await writeFile(allowedFile, allowedContent);
        const wall = createLinuxCommandWall({ roots: [root], open: [openFolder] });
        const files = { deniedFile, deniedContent, allowedFile, allowedContent, openFolder };
        return { wall, ...files, reader: "/bin/cat", linker: "/bin/ln" };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
