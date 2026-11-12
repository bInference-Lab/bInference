import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chatRetentionContract } from "../contracts/chat-retention-contract.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteChatQueueStore } from "./sqlite-chat-queue-store.js";
import { createSqliteChatRetention } from "./sqlite-chat-retention.js";
import { createSqliteSessionStore } from "./sqlite-session-store.js";
import { createSqliteTranscriptStore } from "./sqlite-transcript-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const url = inject("postgres");

// Chat retention's suite on a fresh agent schema per check: the transcript's trigger lets the
// removal through only inside the retention task's own transaction.
describe.runIf(url !== "")("chat retention on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    chatRetentionContract({
      create: async () => {
        const host = await stores.open("agent");
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
});
