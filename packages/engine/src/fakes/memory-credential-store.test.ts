import { describe, expect, it } from "vitest";
import { credentialStoreContract } from "../contracts/credential-store-contract.js";
import { createMemoryCredentialStore } from "./memory-credential-store.js";

describe("the in-memory credential store", () => {
  it.each(
    credentialStoreContract({ create: async () => Promise.resolve(createMemoryCredentialStore()) }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
