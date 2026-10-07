import { afterEach, describe, expect, it } from "vitest";
import { fileAccessContract } from "../contracts/file-access-contract.js";
import { createTempFolder, type TempFolder } from "../fakes/temp-folder.js";
import { createWin32FileAccess } from "./win32-file-access.js";

const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// The adapter only asks whether a path exists, so its contract runs on every OS.
describe("windows file access", () => {
  it.each(
    fileAccessContract({
      create: async () => {
        const folder = await createTempFolder("bnf-");
        folders.push(folder);
        return { access: createWin32FileAccess(), folder: folder.path };
      },
      readsAccess: false,
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
