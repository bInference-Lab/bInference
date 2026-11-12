import { trackedWalletStoreContract } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { trackedWalletSubject } from "../testing/engine-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

describe.runIf(url !== "")("the tracked wallet store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    trackedWalletStoreContract({
      create: async () => trackedWalletSubject(await stores.open("engine")),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
