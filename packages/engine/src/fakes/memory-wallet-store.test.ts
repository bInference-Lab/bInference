import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { walletStoreContract } from "../contracts/wallet-store-contract.js";
import { createMemoryWalletStore } from "./memory-wallet-store.js";

describe("createMemoryWalletStore", () => {
  it.each(
    walletStoreContract({
      create: async (wallets) => {
        const store = createMemoryWalletStore();
        wallets.forEach((wallet) => store.add(wallet));
        return Promise.resolve(store);
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a wallet whose id it holds", () => {
    const store = createMemoryWalletStore();
    const wallet = {
      id: fixtureId("wal", 1),
      agentId: fixtureId("agt", 1),
      label: "Main",
      createdAtMs: 1,
    };
    store.add(wallet);
    expect(() => store.add({ ...wallet, label: "Other" })).toThrow(
      expect.objectContaining({ code: "store.constraint" }),
    );
  });
});
