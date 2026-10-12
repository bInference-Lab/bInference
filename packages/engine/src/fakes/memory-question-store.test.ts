import { describe, expect, it } from "vitest";
import {
  type QuestionSubject,
  questionStoreContract,
} from "../contracts/question-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";

describe("memory question store", () => {
  it.each(
    questionStoreContract({
      create: async (): Promise<QuestionSubject> => {
        const stores = createMemoryEngineStores();
        const agentId = fixtureId("agt", 1);
        await stores.agents.create(testAgentDraft({ id: agentId }), live());
        return { questions: stores.questions, agentInbox: stores.agentInbox, agentId };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
