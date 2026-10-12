import { workspaceFilesContract } from "@binference/core/testing";
import { createPlatform } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { stateWorkspace } from "./state-workspace.js";

const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe("the state folder's workspace", () => {
  it.each(
    workspaceFilesContract({
      create: async () => {
        const folder = await createTempFolder("bnf-sw-");
        folders.push(folder);
        return stateWorkspace(createPlatform({ binferenceHome: folder.path }));
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
