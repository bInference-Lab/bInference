import { accountRefSchema } from "@binference/chain";
import { transactionStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { createIntent } from "../testing/create-intent.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteTransactionStore } from "./sqlite-transaction-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite transaction store", () => {
  it.each(
    transactionStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        const agent = plantAgent(database, 1);
        const { kysely, execute } = createSyncKysely<EngineTables>(database);
        return await Promise.resolve({
          store: createSqliteTransactionStore(host),
          intentIds: [await createIntent(host, agent, 1), await createIntent(host, agent, 2)],
          accounts: [
            accountRefSchema.parse("fake:1:0x0000000a"),
            accountRefSchema.parse("fake:1:0x0000000b"),
          ],
          setState: async (id, state) => {
            execute(kysely.updateTable("txs").set({ state }).where("id", "=", id));
            await Promise.resolve();
          },
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
