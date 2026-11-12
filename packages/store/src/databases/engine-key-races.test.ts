import { storeKeyRaces } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { keyRaceSubject } from "../testing/engine-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { engineDatabase } from "./engine-database.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

// SQLite has one writer per database: eight writers' calls on its host run one at a time, in the
// order they came, and each loser gets its store's own answer.
describe("the sqlite engine stores under eight writers of one key", () => {
  it.each(
    storeKeyRaces({
      create: async () => {
        const { host } = databases.open(engineDatabase);
        return keyRaceSubject(Array.from({ length: 8 }, () => host));
      },
    }),
  )("hold: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
