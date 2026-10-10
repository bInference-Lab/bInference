import { describe, expect, it } from "vitest";
import { ownerStoreContract } from "../contracts/owner-store-contract.js";
import { createMemoryOwnerStore } from "./memory-owner-store.js";

describe("memory owner store", () => {
  it.each(ownerStoreContract({ create: async () => createMemoryOwnerStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
