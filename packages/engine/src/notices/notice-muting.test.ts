import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
import { isNoticeMutedFor } from "./notice-muting.js";

const live = { signal: new AbortController().signal };
const second = fixtureId("agt", 2);

async function agentsMuting(first: readonly string[], other?: readonly string[]) {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({ notifications: { muted: [...first] } }), live);
  if (other !== undefined) {
    const draft = testAgentDraft({
      id: second,
      name: "scout",
      notifications: { muted: [...other] },
    });
    await agents.create(draft, live);
  }
  return agents;
}

describe("a notice the owner muted", () => {
  it("is muted when the agent it names muted its kind", async () => {
    const agents = await agentsMuting(["fill"], []);
    const fill = { key: "notice.fill", values: {} };
    await expect(isNoticeMutedFor(agents, { ...fill, agent: testAgent }, live)).resolves.toBe(true);
    await expect(isNoticeMutedFor(agents, { ...fill, agent: second }, live)).resolves.toBe(false);
  });

  it("goes when it is a security notice, whatever the stored settings say", async () => {
    const agents = await agentsMuting(["frozen", "rescue"]);
    const frozen = { key: "notice.frozen", agent: testAgent, values: { agent: "main" } };
    await expect(isNoticeMutedFor(agents, frozen, live)).resolves.toBe(false);
  });

  it("mutes a notice about the install only when every agent muted it", async () => {
    const update = { key: "notice.updateBare", values: { version: "2026.12.1" } };
    const both = await agentsMuting(["updateBare"], ["updateBare"]);
    const one = await agentsMuting(["updateBare"], []);
    await expect(isNoticeMutedFor(both, update, live)).resolves.toBe(true);
    await expect(isNoticeMutedFor(one, update, live)).resolves.toBe(false);
  });

  it("goes when its agent is unknown or it is not a notice of spec 4", async () => {
    const agents = await agentsMuting(["fill"]);
    const unknown = { key: "notice.fill", agent: second, values: {} };
    await expect(isNoticeMutedFor(agents, unknown, live)).resolves.toBe(false);
    const receipt = { key: "fill.buy", agent: testAgent, values: {} };
    await expect(isNoticeMutedFor(agents, receipt, live)).resolves.toBe(false);
  });
});
