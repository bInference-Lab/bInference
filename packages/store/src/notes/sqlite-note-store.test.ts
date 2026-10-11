import { afterAll, describe, expect, it } from "vitest";
import { createSqliteWriterFence } from "../chats/sqlite-writer-fence.js";
import { noteStoreContract } from "../contracts/note-store-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteNoteStore } from "./sqlite-note-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite note store", () => {
  it.each(
    noteStoreContract({
      create: async () => {
        const { host } = databases.open(agentDatabase);
        return { store: createSqliteNoteStore(host), fence: createSqliteWriterFence(host) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
