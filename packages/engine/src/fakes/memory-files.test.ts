import { describe, expect, it } from "vitest";
import { machineFilesContract } from "../contracts/machine-files-contract.js";
import { createMemoryFiles, memoryFilePlaces } from "./memory-files.js";

describe("the in-memory machine files", () => {
  it.each(
    machineFilesContract({
      create: async () =>
        Promise.resolve({
          files: createMemoryFiles({
            [`${memoryFilePlaces.home}/notes.txt`]: "hello",
            [`${memoryFilePlaces.home}/pictures/a.png`]: "png",
            [`${memoryFilePlaces.state}/keys/agent-key`]: "secret",
          }),
          workspace: memoryFilePlaces.workspace,
          outside: { path: "~/notes.txt", text: "hello" },
          walled: "~/.binference/keys/agent-key",
          folder: "~/pictures",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
