import { describe, expect, it } from "vitest";
import { secretStoreContract } from "../contracts/secret-store-contract.js";
import { createMemorySecretStore } from "./memory-secret-store.js";

describe("memory secret store", () => {
  it.each(secretStoreContract({ create: async (entries) => createMemorySecretStore(entries) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
