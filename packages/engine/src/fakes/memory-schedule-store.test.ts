import { describe, expect, it } from "vitest";
import {
  type ScheduleSubject,
  scheduleStoreContract,
} from "../contracts/schedule-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryEngineStores } from "./memory-engine-stores.js";

describe("memory schedule store", () => {
  it.each(
    scheduleStoreContract({
      create: async (): Promise<ScheduleSubject> => {
        const stores = createMemoryEngineStores();
        const agentId = fixtureId("agt", 1);
        await stores.agents.create(testAgentDraft({ id: agentId }), live());
        return { schedules: stores.schedules, agentInbox: stores.agentInbox, agentId };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
