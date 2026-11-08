import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { goalStoreContract } from "../contracts/goal-store-contract.js";
import { helperStoreContract } from "../contracts/helper-store-contract.js";
import { sessionStoreContract } from "../contracts/session-store-contract.js";
import { writerFenceContract } from "../contracts/writer-fence-contract.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteGoalStore } from "./sqlite-goal-store.js";
import { createSqliteHelperStore } from "./sqlite-helper-store.js";
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

  it.each(
    helperStoreContract({
      create: async () => {
        const host = await stores.open("agent");
        return {
          store: createSqliteHelperStore(host),
          sessions: createSqliteSessionStore(host),
          fence: createSqliteWriterFence(host),
        };
      },
    }),
  )("the helper store follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    goalStoreContract({
      create: async () => {
        const host = await stores.open("agent");
        return {
          store: createSqliteGoalStore(host),
          sessions: createSqliteSessionStore(host),
          fence: createSqliteWriterFence(host),
        };
      },
    }),
  )("the goal store follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
