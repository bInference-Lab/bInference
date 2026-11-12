import { afterAll, describe, expect, it } from "vitest";
import { engineDatabase } from "../databases/engine-database.js";
import { createIntent } from "../testing/create-intent.js";
import { plantAgentOn } from "../testing/plant-agent.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteIntentStore } from "./sqlite-intent-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

const live = () => ({ signal: AbortSignal.timeout(30_000) });

describe("an intent's move", () => {
  it("rolls back whole when its version's update moves no row", async () => {
    const { host, database } = databases.open(engineDatabase);
    const intentId = await createIntent(host, await plantAgentOn(host, 1), 1);
    // A trigger that skips the row stands in for a row the write no longer holds.
    database.exec(
      "CREATE TRIGGER skip_moves BEFORE UPDATE ON intents BEGIN SELECT RAISE(IGNORE); END",
    );
    const store = createSqliteIntentStore(host);
    const move = { id: intentId, expectedVersion: 0, state: "executing" as const, atMs: 2 };

    await expect(store.transition({ ...move, cause: {} }, live())).rejects.toMatchObject({
      code: "store.constraint",
    });
    expect(await store.events(intentId, live())).toHaveLength(1);
    expect((await store.get(intentId, live()))?.version).toBe(0);
  });
});
