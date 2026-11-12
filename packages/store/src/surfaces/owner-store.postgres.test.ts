import { ownerStoreContract } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteOwnerStore } from "./sqlite-owner-store.js";

const url = inject("postgres");

describe.runIf(url !== "")("the owner store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    ownerStoreContract({ create: async () => createSqliteOwnerStore(await stores.open("engine")) }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
