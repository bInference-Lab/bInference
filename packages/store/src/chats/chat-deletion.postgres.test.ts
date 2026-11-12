import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chatDeletionContract } from "../contracts/chat-deletion-contract.js";
import { chatDeletionSubject } from "../testing/agent-store-subjects.js";
import {
  createTestPostgresStores,
  type TestPostgresStores,
} from "../testing/test-postgres-stores.js";

const url = inject("postgres");

// Chat deletion's suite on a fresh agent schema per check: the transcript's trigger lets the
// removal through only inside the deletion's own transaction.
describe.runIf(url !== "")("chat deletion on Postgres", () => {
  let stores: TestPostgresStores;
  beforeAll(async () => {
    stores = await createTestPostgresStores(url);
  });
  afterAll(async () => {
    await stores.closeAll();
  });

  it.each(
    chatDeletionContract({
      create: async () => chatDeletionSubject(await stores.open("agent")),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
