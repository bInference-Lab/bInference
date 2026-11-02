import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { unbondingStoreContract } from "../contracts/unbonding-store-contract.js";
import { createMemoryUnbondingStore } from "./memory-unbonding-store.js";

const intentIds = [fixtureId("int", 1), fixtureId("int", 2), fixtureId("int", 3)] as const;

describe("memory unbonding store", () => {
  it.each(
    unbondingStoreContract({
      create: async () =>
        await Promise.resolve({
          store: createMemoryUnbondingStore({ hasIntent: (id) => intentIds.includes(id) }),
          intentIds,
          walletId: fixtureId("wal", 1),
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
