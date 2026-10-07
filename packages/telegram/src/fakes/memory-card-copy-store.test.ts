import { describe, expect, it } from "vitest";
import { cardCopyStoreContract } from "../contracts/card-copy-store-contract.js";
import { createMemoryCardCopyStore } from "./memory-card-copy-store.js";

describe("memory card copy store", () => {
  it.each(cardCopyStoreContract({ create: async () => createMemoryCardCopyStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
