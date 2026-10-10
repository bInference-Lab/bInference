import { noticeStoreContract, testAgent, testAgentDraft } from "@binference/engine/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqliteAgentStore } from "../agents/sqlite-agent-store.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";
import { createSqliteNoticeStore } from "./sqlite-notice-store.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

async function subject() {
  const { host } = databases.open(engineDatabase);
  await createSqliteAgentStore(host).create(testAgentDraft(), {
    signal: new AbortController().signal,
  });
  return { notices: createSqliteNoticeStore(host), agent: testAgent };
}

describe("sqlite notice store", () => {
  it.each(noticeStoreContract({ create: subject }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
