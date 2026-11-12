import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { agentKeyRaces } from "../contracts/agent-key-races.js";
import { agentRaceSubject } from "../testing/agent-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

// Eight writers of one install's agent schema, each with its own pool, task thread and write queue
// (decision 0366): two inserts of one key meet as a serialization failure or a unique violation,
// the loser runs again from its first read (decision 0413) and gets its store's own answer, and
// each race must run a write again at least once.
describe.runIf(url !== "")("the agent stores on Postgres under eight writers of one key", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    agentKeyRaces({
      create: async () => ({
        ...agentRaceSubject(await stores.writers(8, "agent")),
        retries: () => stores.retries(),
      }),
    }),
  )("hold: $name", { timeout: 120_000 }, async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
