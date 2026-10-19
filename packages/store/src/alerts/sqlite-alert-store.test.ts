import { alertStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentInboxStore } from "../agent-inbox/sqlite-agent-inbox-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteAlertStore } from "./sqlite-alert-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite alert store", () => {
  it.each(
    alertStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        const first = plantAgent(database, 1).agentId;
        const second = plantAgent(database, 2).agentId;
        return {
          alerts: createSqliteAlertStore(host),
          agentInbox: createSqliteAgentInboxStore(host),
          agentIds: [first, second] as const,
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
