import { describe, expect, it } from "vitest";
import { shellStoreContract } from "../contracts/shell-store-contract.js";
import { createMemoryShellStore } from "./memory-shell-store.js";

describe("the in-memory shell store", () => {
  it.each(shellStoreContract({ create: async () => Promise.resolve(createMemoryShellStore()) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
