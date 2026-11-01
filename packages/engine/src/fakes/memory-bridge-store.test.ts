import { describe, expect, it } from "vitest";
import { bridgeStoreContract } from "../contracts/bridge-store-contract.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryBridgeStore } from "./memory-bridge-store.js";

const intentIds = [fixtureId("int", 1), fixtureId("int", 2)] as const;

describe("memory bridge store", () => {
  it.each(
    bridgeStoreContract({
      create: async () =>
        await Promise.resolve({
          store: createMemoryBridgeStore({ hasIntent: (id) => intentIds.includes(id) }),
          intentIds,
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
