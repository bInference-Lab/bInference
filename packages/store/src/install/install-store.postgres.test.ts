import { installStoreContract } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { installSubject } from "../testing/engine-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

describe.runIf(url !== "")("the install store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    installStoreContract({ create: async () => installSubject(await stores.open("engine")) }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
