import { moneyWriteRaces } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { moneyRaceSubject } from "../testing/money-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

// SQLite has one writer per database: eight writers' calls on its host run one at a time, in the
// order they came, and every rule must hold the same.
describe("the sqlite money stores under eight writers", () => {
  it.each(
    moneyWriteRaces({
      create: async () => {
        const { host } = databases.open(engineDatabase);
        return moneyRaceSubject(Array.from({ length: 8 }, () => host));
      },
    }),
  )("hold: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
