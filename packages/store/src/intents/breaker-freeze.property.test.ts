import { idSchema } from "@binference/core";
import {
  type BreakerFreezeSubject,
  breakerFreezeProperty,
  testAgentDraft,
} from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createSqliteInstallStore } from "../install/sqlite-install-store.js";
import { createSqliteOrderStore } from "../orders/sqlite-order-store.js";
import { plantWalletOn } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteTransactionStore } from "../transactions/sqlite-transaction-store.js";
import { createSqliteIntentStore } from "./sqlite-intent-store.js";

const databases = createTestDatabases();
const secondId = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");
afterAll(() => {
  databases.closeAll();
});

const options = { signal: new AbortController().signal };

// A fresh engine database's stores, with two agents the agent store made and their wallets.
async function sqliteSubject(): Promise<BreakerFreezeSubject> {
  const { host } = databases.open(engineDatabase);
  const agents = createSqliteAgentStore(host);
  await agents.create(testAgentDraft({}), options);
  const first = await plantWalletOn(host, 1);
  await agents.create(testAgentDraft({ id: secondId, name: "second" }), options);
  return {
    agents,
    intents: createSqliteIntentStore(host),
    install: createSqliteInstallStore(host),
    orders: createSqliteOrderStore(host),
    transactions: createSqliteTransactionStore(host),
    first,
    second: secondId,
  };
}

describe("the owner's freeze and the breaker's hold, on SQLite", () => {
  it("never end each other, and the order is paused exactly while its agent is held", async () => {
    await expect(breakerFreezeProperty(sqliteSubject, 40)).resolves.toBeUndefined();
  }, 120_000);
});
