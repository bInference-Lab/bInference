import { bridgeStoreContract } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { bridgeSubject } from "../testing/engine-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

describe.runIf(url !== "")("the bridge store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(bridgeStoreContract({ create: async () => bridgeSubject(await stores.open("engine")) }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
