import { realpathSync } from "node:fs";
import { createManualClock } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { shellLauncherContract } from "../contracts/shell-launcher-contract.js";
import { createTempFolder, type TempFolder } from "../fakes/temp-folder.js";
import type { CommandWall } from "../ports.js";
import { createMacosCommandWall } from "./macos-command-wall.js";
import { createPosixShellLauncher, posixShellProgram } from "./posix-shell-launcher.js";

const folders: TempFolder[] = [];

async function scratch(): Promise<string> {
  const folder = await createTempFolder("bnf-shell-");
  folders.push(folder);
  return realpathSync(folder.path);
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

const commands = {
  printsAndExits: "echo out; echo err 1>&2; exit 3",
  printsFolder: "pwd",
  waitsOnChild: "sleep 60 & wait",
};

describe.runIf(process.platform === "darwin")("posix shell launcher on macOS", () => {
  it.each(
    shellLauncherContract({
      walls: true,
      create: async () => {
        const folder = await scratch();
        const wall: CommandWall = createMacosCommandWall({ roots: [await scratch()], open: [] });
        const clock = createManualClock();
        const launcher = createPosixShellLauncher(wall, { loginShell: "/bin/zsh", clock });
        return { launcher, advance: clock.advance, folder, commands };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});

describe.skipIf(process.platform === "win32")("the posix shell program", () => {
  it("runs bash and zsh without their startup files", () => {
    expect(posixShellProgram("/bin/zsh")).toStrictEqual({ file: "/bin/zsh", args: ["-f", "-c"] });
    expect(posixShellProgram("/bin/bash")).toStrictEqual({
      file: "/bin/bash",
      args: ["--noprofile", "--norc", "-c"],
    });
  });

  it("gives way to bash for a login shell that refuses commands or is not a path", () => {
    for (const shell of ["/usr/bin/false", "fish", undefined]) {
      expect(posixShellProgram(shell).file).toBe("/bin/bash");
    }
  });
});
