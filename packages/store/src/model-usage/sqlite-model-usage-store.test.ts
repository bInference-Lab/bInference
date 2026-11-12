import { idSchema } from "@binference/core";
import { fixtureId, modelUsageStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { withTwoAgents } from "../testing/engine-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteModelUsageStore } from "./sqlite-model-usage-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = { signal: new AbortController().signal };

// A usage store on a fresh database that holds the contract's two agents.
async function storeWithAgents() {
  const { host, database } = databases.open(engineDatabase);
  return { store: createSqliteModelUsageStore(await withTwoAgents(host)), database };
}

describe("sqlite model usage store", () => {
  it.each(modelUsageStoreContract({ create: async () => (await storeWithAgents()).store }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("keeps one row for each attempt's key, with its cost as decimal text", async () => {
    const { store, database } = await storeWithAgents();
    const charge = {
      agent: fixtureId("agt", 1),
      turn: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
      key: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001.usage.1",
      model: "openai/gpt-5.4",
      inputTokens: 5,
      outputTokens: 1,
      cachedTokens: 0,
      usdMicros: 2n ** 64n + 1n,
      atMs: 9,
    };
    await store.record(charge, live);
    await store.record({ ...charge, usdMicros: 1n }, live);
    expect(database.prepare("SELECT key, usd_micros FROM model_usage").all()).toEqual([
      { key: charge.key, usd_micros: "18446744073709551617" },
    ]);
  });

  it("refuses usage of an agent it does not hold", async () => {
    const { store } = await storeWithAgents();
    const charge = {
      agent: fixtureId("agt", 9),
      turn: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
      key: "k",
      model: "m",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      usdMicros: 0n,
      atMs: 0,
    };
    await expect(store.record(charge, live)).rejects.toMatchObject({ code: "store.constraint" });
  });
});
