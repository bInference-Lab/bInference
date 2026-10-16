import { describe, expect, it } from "vitest";
import {
  type ScheduleSubject,
  scheduleStoreContract,
} from "../contracts/schedule-store-contract.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgentDraft } from "../intents/test-intents.js";
import { createMemoryAgentInboxStore } from "./memory-agent-inbox-store.js";
import { createMemoryAgentStore } from "./memory-agent-store.js";
import { createMemoryInstallStore } from "./memory-install-store.js";
import { createMemoryScheduleStore } from "./memory-schedule-store.js";

describe("memory schedule store", () => {
  it.each(
    scheduleStoreContract({
      create: async (): Promise<ScheduleSubject> => {
        const agents = createMemoryAgentStore({ install: createMemoryInstallStore() });
        const agentInbox = createMemoryAgentInboxStore({ agents });
        const agentId = fixtureId("agt", 1);
        await agents.create(testAgentDraft({ id: agentId }), live());
        const schedules = createMemoryScheduleStore({ agents, agentInbox });
        return { schedules, agentInbox, agentId };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
