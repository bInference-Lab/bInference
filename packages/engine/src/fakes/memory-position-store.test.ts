import { describe, expect, it } from "vitest";
import { positionStoreContract } from "../contracts/position-store-contract.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryPositionStore } from "./memory-position-store.js";

describe("memory position store", () => {
  it.each(
    positionStoreContract({
      create: async () => ({
        store: createMemoryPositionStore(),
        walletIds: [fixtureId("wal", 1), fixtureId("wal", 2)],
        intentId: fixtureId("int", 1),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
