import { agentInboxStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createSqliteInstallStore } from "../install/sqlite-install-store.js";
import { createSqliteIntentStore } from "../intents/sqlite-intent-store.js";
import { createSqliteLedgerStore } from "../ledger/sqlite-ledger-store.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { agentInboxTasks, createSqliteAgentInboxStore } from "./sqlite-agent-inbox-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite agent inbox store", () => {
  it.each(
    agentInboxStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        return {
          store: createSqliteIntentStore(host),
          ledger: createSqliteLedgerStore(host),
          agents: createSqliteAgentStore(host),
          install: createSqliteInstallStore(host),
          agentInbox: createSqliteAgentInboxStore(host),
          ...plantAgent(database, 1),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("has every task it runs served by the engine database's workers", () => {
    expect(engineDatabase.tasks).toStrictEqual(expect.arrayContaining([...agentInboxTasks]));
  });
});
