import { describe, expect, it } from "vitest";
import { idempotencyStoreContract } from "../contracts/idempotency-store-contract.js";
import { createMemoryIdempotencyStore } from "./memory-idempotency-store.js";

describe("memory idempotency store", () => {
  it.each(idempotencyStoreContract({ create: async () => createMemoryIdempotencyStore() }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
