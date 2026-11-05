import { moneyWriteRaces } from "@binference/engine/testing";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { moneyRaceSubject } from "../testing/money-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

// Eight writers of one install's engine schema, each with its own pool, task thread and write
// queue, as several services write one install (decision 0366): their writes interleave under
// SERIALIZABLE, a conflict runs a write again or ends it store.write_conflict, and each race must
// run a write again at least once.
describe.runIf(url !== "")("the money stores on Postgres under eight writers", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    moneyWriteRaces({
      create: async () => ({
        ...(await moneyRaceSubject(await stores.writers(8))),
        retries: () => stores.retries(),
      }),
      propertyRuns: 25,
    }),
  )("hold: $name", { timeout: 120_000 }, async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
