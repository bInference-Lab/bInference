import { webhookRuleStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createSqliteIntentStore } from "../intents/sqlite-intent-store.js";
import { plantAgent } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteWebhookAlertStore } from "./sqlite-webhook-alert-store.js";
import { createSqliteWebhookRuleStore } from "./sqlite-webhook-rule-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite webhook rule store", () => {
  it.each(
    webhookRuleStoreContract({
      create: async () => {
        const { host, database } = databases.open(engineDatabase);
        return Promise.resolve({
          store: createSqliteWebhookRuleStore(host),
          alerts: createSqliteWebhookAlertStore(host),
          intents: createSqliteIntentStore(host),
          agents: createSqliteAgentStore(host),
          ...plantAgent(database, 1),
          other: plantAgent(database, 2),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
