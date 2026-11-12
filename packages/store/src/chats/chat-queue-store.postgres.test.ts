import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chatQueueStoreContract } from "../contracts/chat-queue-store-contract.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteChatQueueStore } from "./sqlite-chat-queue-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const url = inject("postgres");

// The chat queue's suite on a fresh agent schema per check, its arrival order from the counter row
// that agent 0005 sets each message's `seq` from.
describe.runIf(url !== "")("the chat queue on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    chatQueueStoreContract({
      create: async () => {
        const host = await stores.open("agent");
        return { store: createSqliteChatQueueStore(host), fence: createSqliteWriterFence(host) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
