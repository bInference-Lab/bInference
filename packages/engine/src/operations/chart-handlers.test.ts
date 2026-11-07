import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createChartHandlers } from "./chart-handlers.js";
import { testCall } from "./test-engine.js";

const turn = fixtureId("trn", 1);
const chart = {
  chartType: "bar" as const,
  title: "Volume",
  categories: ["Mon"],
  series: [{ name: "Buys", values: [3] }],
};

describe("turn/chart", () => {
  it("pushes the chart on the agent's chat topic and answers it", async () => {
    const agents = createMemoryAgentStore();
    await agents.create(testAgentDraft({}), testCall({}));
    const pushes: EnginePush[] = [];
    const handlers = createChartHandlers({ agents, publish: (push) => pushes.push(push) });
    expect(await handlers["turn/chart"](testCall({ agent: testAgent, turn, chart }))).toStrictEqual(
      {
        ok: true,
        value: { chart },
      },
    );
    expect(pushes).toStrictEqual([
      { topic: `chat:${testAgent}`, kind: "chat/chart", data: { agent: testAgent, turn, chart } },
    ]);
  });

  it("refuses an unknown agent and pushes nothing", async () => {
    const pushes: EnginePush[] = [];
    const handlers = createChartHandlers({
      agents: createMemoryAgentStore(),
      publish: (push) => pushes.push(push),
    });
    expect(await handlers["turn/chart"](testCall({ agent: testAgent, turn, chart }))).toStrictEqual(
      {
        ok: false,
        error: "agent.not_found",
      },
    );
    expect(pushes).toStrictEqual([]);
  });
});
