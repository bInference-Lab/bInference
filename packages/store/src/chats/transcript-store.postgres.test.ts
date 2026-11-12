import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { transcriptStoreContract } from "../contracts/transcript-store-contract.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteSessionStore } from "./sqlite-session-store.js";
import { createSqliteTranscriptStore } from "./sqlite-transcript-store.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const url = inject("postgres");

// The transcript's suite on a fresh agent schema per check.
describe.runIf(url !== "")("the transcript store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    transcriptStoreContract({
      create: async () => {
        const host = await stores.open("agent");
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
