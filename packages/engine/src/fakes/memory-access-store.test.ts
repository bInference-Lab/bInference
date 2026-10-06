import { describe, expect, it } from "vitest";
import { accessStoreContract } from "../contracts/access-store-contract.js";
import { createMemoryAccessStore } from "./memory-access-store.js";

describe("memory access store", () => {
  it.each(accessStoreContract({ create: async () => createMemoryAccessStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
