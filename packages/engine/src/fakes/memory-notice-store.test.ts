import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { noticeStoreContract } from "../contracts/notice-store-contract.js";
import { live } from "../contracts/store-fixtures.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
import { createMemoryAgentStore } from "./memory-agent-store.js";
import { createMemoryNoticeStore } from "./memory-notice-store.js";

async function subject() {
  const agents = createMemoryAgentStore();
  const created = await agents.create(testAgentDraft(), live());
  if (!created.ok) {
    throw new BinferenceError({ code: "test.seed_failed", message: "The agent is stored." });
  }
  return { notices: createMemoryNoticeStore({ agents }), agent: testAgent };
}

describe("memory notice store", () => {
  it.each(noticeStoreContract({ create: subject }))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
