import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandWallContract } from "../contracts/command-wall-contract.js";
import { createTempFolder, type TempFolder } from "../fakes/temp-folder.js";
import { runCommandToExit } from "../run-command.js";
import { createMacosCommandWall } from "./macos-command-wall.js";

const folders: TempFolder[] = [];

async function scratch(): Promise<string> {
  const folder = await createTempFolder("bnf-wall-");
  folders.push(folder);
  // Seatbelt matches canonical paths; macOS temp folders sit under a symlink.
  return realpathSync(folder.path);
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe.runIf(process.platform === "darwin")("macos command wall", () => {
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
        const allowedFile = join(await scratch(), "ok.txt");
        const allowedContent = "readable";
        await writeFile(allowedFile, allowedContent);
        const wall = createMacosCommandWall({
          roots: [root],
          open: [join(root, "workspace")],
        });
        return { wall, deniedFile, deniedContent, allowedFile, allowedContent, reader: "/bin/cat" };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("lets a command use the open workspace but not a file made later elsewhere in the state folder", async () => {
    const root = await scratch();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "notes.txt"), "open");
    const wall = createMacosCommandWall({ roots: [root], open: [workspace] });
    // The journal is written after the wall is built, as SQLite writes one mid-session.
    await writeFile(join(root, "engine.sqlite-journal"), "journal-bytes");
    const read = async (file: string) => {
      const wrapped = wall.wrap({ file: "/bin/cat", args: [file] });
      return runCommandToExit(wrapped.file, wrapped.args, AbortSignal.timeout(15_000));
    };
    expect((await read(join(workspace, "notes.txt"))).stdout).toBe("open");
    const journal = await read(join(root, "engine.sqlite-journal"));
    expect([journal.exitCode === 0, journal.stdout]).toStrictEqual([false, ""]);
  });

  it("holds the wall where sandbox-exec is present", async () => {
    const wall = createMacosCommandWall({ roots: [await scratch()], open: [] });
    expect(wall.state.kind).toBe("held");
  });
});
