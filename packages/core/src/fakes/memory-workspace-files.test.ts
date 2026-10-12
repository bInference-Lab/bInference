import { describe, expect, it } from "vitest";
import { workspaceFilesContract } from "../contracts/workspace-files-contract.js";
import { createManualClock } from "./manual-clock.js";
import { createMemoryWorkspaceFiles } from "./memory-workspace-files.js";

describe("memory workspace files", () => {
  it.each(
    workspaceFilesContract({
      create: async () => createMemoryWorkspaceFiles(createManualClock(1_000)),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
