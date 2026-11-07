import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { shellLauncherContract } from "../contracts/shell-launcher-contract.js";
import { createWin32CommandWall } from "./win32-command-wall.js";
import { createWin32ShellLauncher } from "./win32-shell-launcher.js";

describe.runIf(process.platform === "win32")("win32 shell launcher", () => {
  it.each(
    shellLauncherContract({
      walls: false,
      create: async () =>
        Promise.resolve({
          launcher: createWin32ShellLauncher(createWin32CommandWall(), createManualClock()),
          advance: async () => Promise.resolve(),
          folder: "C:\\",
          commands: { printsAndExits: "", printsFolder: "", waitsOnChild: "" },
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
