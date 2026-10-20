import { describe, expect, it } from "vitest";
import { aliveStoreContract } from "../contracts/alive-store-contract.js";
import { createMemoryAliveStore } from "./memory-alive-store.js";

describe("memory alive store", () => {
  it.each(aliveStoreContract({ create: async () => createMemoryAliveStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
