import { afterAll, describe, expect, it } from "vitest";
import { chatRetentionContract } from "../contracts/chat-retention-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
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

  it("leaves no cutoff behind, so a removal outside retention still fails", async () => {
    const { host, database } = databases.open(agentDatabase);
    const fence = await createSqliteWriterFence(host).raise({
      signal: new AbortController().signal,
    });
    const pruned = await createSqliteChatRetention(host).prune(
      { beforeMs: 5_000, fence },
      { signal: new AbortController().signal },
    );
    expect(pruned.ok).toBe(true);
    expect(
      database.prepare("SELECT value FROM meta WHERE key = 'prune_before'").all(),
    ).toStrictEqual([]);
  });
});
