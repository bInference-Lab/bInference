import { describe, expect, it } from "vitest";
import { commandWallContract } from "../contracts/command-wall-contract.js";
import { createWin32CommandWall } from "./win32-command-wall.js";

// The Windows wall runs on every OS in the unit suite, since it needs no OS mechanism: it always
// answers `none`, and the shell is off on Windows outside the image.
describe("win32 command wall", () => {
  it.each(
    commandWallContract({
      walls: false,
      create: async () => ({
        wall: createWin32CommandWall(),
        deniedFile: "",
        deniedContent: "",
        allowedFile: "",
        allowedContent: "",
        reader: "",
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("names why it has no wall", () => {
    const wall = createWin32CommandWall();
    expect(wall.state).toMatchObject({ kind: "none" });
  });
});
