import { describe, expect, it } from "vitest";
import { ledgerStoreContract } from "../contracts/ledger-store-contract.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryLedgerStore } from "./memory-ledger-store.js";

describe("memory ledger store", () => {
  it.each(
    ledgerStoreContract({
      create: async () => ({ ledger: createMemoryLedgerStore(), agentId: fixtureId("agt", 1) }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
