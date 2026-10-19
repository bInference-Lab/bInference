import { describe, expect, it } from "vitest";
import { launchStoreContract } from "../contracts/launch-store-contract.js";
import { createMemoryLaunchStore } from "./memory-launch-store.js";

describe("memory launch store", () => {
  it.each(launchStoreContract({ create: async () => createMemoryLaunchStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
