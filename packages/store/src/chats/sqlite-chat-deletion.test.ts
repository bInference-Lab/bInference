import { afterAll, describe, expect, it } from "vitest";
import { chatDeletionContract } from "../contracts/chat-deletion-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { chatDeletionSubject } from "../testing/agent-store-subjects.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite chat deletion", () => {
  it.each(
    chatDeletionContract({
      create: async () => chatDeletionSubject(databases.open(agentDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
