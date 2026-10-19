import { trackedWalletStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentInboxStore } from "../agent-inbox/sqlite-agent-inbox-store.js";
import { createSqliteAlertStore } from "../alerts/sqlite-alert-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteTrackedWalletStore } from "./sqlite-tracked-wallet-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite tracked wallet store", () => {
  it.each(
    trackedWalletStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        const first = plantAgent(database, 1).agentId;
        const second = plantAgent(database, 2).agentId;
        const { kysely, execute } = createSyncKysely<EngineTables>(database);
        const archive = async (agent: string) => {
          execute(kysely.updateTable("agents").set({ archived_at: 1 }).where("id", "=", agent));
          return Promise.resolve();
        };
        return {
          alerts: createSqliteAlertStore(host),
          agentInbox: createSqliteAgentInboxStore(host),
          tracked: createSqliteTrackedWalletStore(host),
          agentIds: [first, second] as const,
          archive,
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
