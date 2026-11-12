import { storeKeyRaces } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { keyRaceSubject } from "../testing/engine-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

// Eight writers of one install's engine schema, each with its own pool, task thread and write
// queue (decision 0366): two inserts of one key meet as a serialization failure or a unique
// violation, the loser runs again from its first read (decision 0413) and gets its store's own
// answer, and each race must run a write again at least once.
describe.runIf(url !== "")("the engine stores on Postgres under eight writers of one key", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    storeKeyRaces({
      create: async () => ({
        ...(await keyRaceSubject(await stores.writers(8))),
        retries: () => stores.retries(),
      }),
    }),
  )("hold: $name", { timeout: 120_000 }, async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
