import { modelUsageStoreContract } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { withTwoAgents } from "../testing/engine-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteModelUsageStore } from "./sqlite-model-usage-store.js";

const url = inject("postgres");

describe.runIf(url !== "")("the model usage store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    modelUsageStoreContract({
      create: async () =>
        createSqliteModelUsageStore(await withTwoAgents(await stores.open("engine"))),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
