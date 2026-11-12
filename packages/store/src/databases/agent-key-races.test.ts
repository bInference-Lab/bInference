import { afterAll, describe, expect, it } from "vitest";
import { agentKeyRaces } from "../contracts/agent-key-races.js";
import { agentRaceSubject } from "../testing/agent-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { agentDatabase } from "./agent-database.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

// SQLite has one writer per database: eight writers' calls on its host run one at a time, in the
// order they came, and each loser gets its store's own answer.
describe("the sqlite agent stores under eight writers of one key", () => {
  it.each(
    agentKeyRaces({
      create: async () => {
        const { host } = databases.open(agentDatabase);
        return agentRaceSubject(Array.from({ length: 8 }, () => host));
      },
    }),
  )("hold: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
