import { installStoreContract, testAgentDraft } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteInstallStore } from "./sqlite-install-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("sqlite install store", () => {
  it.each(
    installStoreContract({
      create: async () => {
        const { host } = databases.open(engineDatabase);
        const draft = testAgentDraft();
        await createSqliteAgentStore(host).create(draft, { signal: new AbortController().signal });
        // The engine database takes the families the registry serves.
        return { store: createSqliteInstallStore(host), agent: draft.id, family: "evm" };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
