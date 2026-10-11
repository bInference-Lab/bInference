import { afterAll, describe, expect, it } from "vitest";
import { writerFenceContract } from "../contracts/writer-fence-contract.js";
import { agentDatabase } from "../databases/agent-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteWriterFence } from "./sqlite-writer-fence.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite writer fence", () => {
  it.each(
    writerFenceContract({
      create: async () => createSqliteWriterFence(databases.open(agentDatabase).host),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
