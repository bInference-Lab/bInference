import { afterAll, describe, expect, it } from "vitest";
import { transcriptStoreContract } from "../contracts/transcript-store-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteSessionStore } from "./sqlite-session-store.js";
import { createSqliteTranscriptStore } from "./sqlite-transcript-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite transcript store", () => {
  it.each(
    transcriptStoreContract({
      create: async () => {
        const { host } = databases.open(agentDatabase);
        return {
          store: createSqliteTranscriptStore(host),
          sessions: createSqliteSessionStore(host),
          fence: createSqliteWriterFence(host),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
