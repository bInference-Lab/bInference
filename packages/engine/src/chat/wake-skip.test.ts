import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { AgentSettings } from "../agents/agent-record.js";
import { live } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
import { wakeSkipOf } from "./wake-skip.js";

async function settings(): Promise<AgentSettings> {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), live());
  const found = await agents.get(testAgent, live());
  if (found === undefined) {
    throw new Error("The test agent is missing.");
  }
  return found;
}

const opens = { open: async () => Promise.resolve(1_000_000n) };

function failingWith(fault: Readonly<BinferenceError>) {
  return { open: async () => Promise.reject(fault) };
}

const spent = new BinferenceError({ code: "agent.budget", message: "The budget is spent." });
const down = new BinferenceError({ code: "store.unavailable", message: "The store is down." });

describe("why a wake-up starts no turn (decision 0232)", () => {
  it("starts a turn for an active agent with budget left", async () => {
    await expect(wakeSkipOf(opens, await settings(), live().signal)).resolves.toBe(undefined);
  });

  it("skips an agent that is gone or archived as archived", async () => {
    const agent = await settings();
    const archived = { ...agent, agent: { ...agent.agent, archivedAtMs: 5 } };
    await expect(wakeSkipOf(opens, undefined, live().signal)).resolves.toBe("archived");
    await expect(wakeSkipOf(opens, archived, live().signal)).resolves.toBe("archived");
  });

  it("skips a frozen agent before reading its budget", async () => {
    const agent = await settings();
    const frozen = { ...agent, agent: { ...agent.agent, frozenAtMs: 5 } };
    await expect(wakeSkipOf(failingWith(down), frozen, live().signal)).resolves.toBe("frozen");
  });

  it("skips an agent whose budget of the day is spent, and throws any other fault", async () => {
    const agent = await settings();
    await expect(wakeSkipOf(failingWith(spent), agent, live().signal)).resolves.toBe("budget");
    await expect(wakeSkipOf(failingWith(down), agent, live().signal)).rejects.toBe(down);
  });
});
