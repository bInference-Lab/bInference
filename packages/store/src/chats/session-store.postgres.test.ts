import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sessionStoreContract } from "../contracts/session-store-contract.js";
import { writerFenceContract } from "../contracts/writer-fence-contract.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteSessionStore } from "./sqlite-session-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const url = inject("postgres");

describe.runIf(url !== "")("the session store and writer fence on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    writerFenceContract({
      create: async () => createSqliteWriterFence(await stores.open("agent")),
    }),
  )("the writer fence follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    sessionStoreContract({
      create: async () => {
        const host = await stores.open("agent");
        return { store: createSqliteSessionStore(host), fence: createSqliteWriterFence(host) };
      },
    }),
  )("the session store follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
