import { describe, expect, it } from "vitest";
import { inboxStoreContract } from "../contracts/inbox-store-contract.js";
import { createMemoryInboxStore } from "./memory-inbox-store.js";

describe("memory inbox store", () => {
  it.each(inboxStoreContract({ create: async () => createMemoryInboxStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
