import { cardCopyStoreContract } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { plantCardVersions } from "../testing/engine-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteCardCopyStore } from "./sqlite-card-copy-store.js";

const url = inject("postgres");

describe.runIf(url !== "")("the card copy store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    cardCopyStoreContract({
      create: async (cards) => {
        const host = await stores.open("engine");
        await plantCardVersions(host, cards);
        return createSqliteCardCopyStore(host);
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
