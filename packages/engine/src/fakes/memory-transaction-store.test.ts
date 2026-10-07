import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { transactionStoreContract } from "../contracts/transaction-store-contract.js";
import { createMemoryTransactionStore } from "./memory-transaction-store.js";

describe("memory transaction store", () => {
  it.each(
    transactionStoreContract({
      create: async () => {
        const store = createMemoryTransactionStore();
        return await Promise.resolve({
          store,
          intentIds: [fixtureId("int", 1), fixtureId("int", 2)],
          accounts: [
            accountRefSchema.parse("fake:1:0x0000000a"),
            accountRefSchema.parse("fake:1:0x0000000b"),
          ],
          setState: async (id, state) => {
            store.setState(id, state);
            await Promise.resolve();
          },
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses to move a transaction it does not hold", () => {
    expect(() => {
      createMemoryTransactionStore().setState(fixtureId("tx", 1), "sent");
    }).toThrow(expect.objectContaining({ code: "store.constraint" }));
  });
});
