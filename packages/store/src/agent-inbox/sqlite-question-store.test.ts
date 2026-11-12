import { questionStoreContract } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { questionSubject } from "../testing/engine-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { questionTasks } from "./sqlite-question-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite question store", () => {
  it.each(
    questionStoreContract({
      create: async () => questionSubject(databases.open(engineDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("has every task it runs served by the engine database's workers", () => {
    expect(engineDatabase.tasks).toStrictEqual(expect.arrayContaining([...questionTasks]));
  });
});
