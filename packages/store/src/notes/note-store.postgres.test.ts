import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createSqliteWriterFence } from "../chats/sqlite-writer-fence.js";
import { noteStoreContract } from "../contracts/note-store-contract.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";
import { createSqliteNoteStore } from "./sqlite-note-store.js";

const url = inject("postgres");

// The note store's suite on a fresh agent schema per check: the trigram index in place of
// notes_fts, and a search that finds the notes SQLite finds (decision 0414).
describe.runIf(url !== "")("the note store on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    noteStoreContract({
      create: async () => {
        const host = await stores.open("agent");
        return { store: createSqliteNoteStore(host), fence: createSqliteWriterFence(host) };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
