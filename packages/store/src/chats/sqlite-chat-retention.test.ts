import { afterAll, describe, expect, it } from "vitest";
import { agentTablesContract } from "../contracts/agent-tables-contract.js";
import { chatRetentionContract } from "../contracts/chat-retention-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { agentTablesSubject } from "../testing/agent-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteChatQueueStore } from "./sqlite-chat-queue-store.js";
import { createSqliteChatRetention } from "./sqlite-chat-retention.js";
import { createSqliteSessionStore } from "./sqlite-session-store.js";
import { createSqliteTranscriptStore } from "./sqlite-transcript-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite chat retention", () => {
  it.each(
    chatRetentionContract({
      create: async () => {
        const { host } = databases.open(agentDatabase);
        return {
          retention: createSqliteChatRetention(host),
          sessions: createSqliteSessionStore(host),
          transcript: createSqliteTranscriptStore(host),
          queue: createSqliteChatQueueStore(host),
          fence: createSqliteWriterFence(host),
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    agentTablesContract({
      create: async () => agentTablesSubject(databases.open(agentDatabase).host),
    }),
  )("keeps the agent tables' rules: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
