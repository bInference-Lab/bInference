import { launchStoreContract } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readsPastOldEscape } from "../testing/old-json-text.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteLaunchStore } from "./sqlite-launch-store.js";

const url = inject("postgres");

describe.runIf(url !== "")("the launch store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    launchStoreContract({
      create: async () => createSqliteLaunchStore(await stores.open("engine")),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("lists launches and reads JSON fields past a row that holds an escaped U+0000", async () => {
    await expect(readsPastOldEscape(await stores.open("engine"))).resolves.toBeUndefined();
  });
});
