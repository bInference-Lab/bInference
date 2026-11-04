import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testLimits, testNowMs } from "../intents/test-intents.js";
import { startTestEngine, testCall } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { present } from "../surfaces/test-venues.js";
import { agentGuardsOf } from "./restore-guards.js";

const live = { signal: new AbortController().signal };

describe("an agent's guards as a restore reads them", () => {
  it("keep its freeze, its archive and the looser level and limits that wait for their time", async () => {
    const test = await startTestEngine({ agent: { sendLevel: 2 } });
    const { handlers } = test.engine;
    expectOk(await handlers["safety/freeze"](testCall({ agent: testAgent })));
    expectOk(await handlers["sendLevel/set"](testCall({ agent: testAgent, level: 0 })));
    const changes = { perTradeUsdMicros: 2_000_000_000n };
    expectOk(await handlers["limit/set"](testCall({ agent: testAgent, changes })));
    const settings = present(await test.stores.agents.get(testAgent, live));
    const archived = { ...settings, agent: { ...settings.agent, archivedAtMs: testNowMs } };
    const removed = [{ id: "adr_1", removedAtMs: testNowMs }];

    expect(agentGuardsOf(archived, removed)).toStrictEqual({
      agentId: testAgent,
      name: "main",
      mode: "paper",
      frozenAtMs: testNowMs,
      archivedAtMs: testNowMs,
      approvalMode: "manual",
      sendLevel: { level: 2, pending: { level: 0, atMs: testNowMs + looseningWaitMs } },
      limits: {
        values: testLimits,
        pending: {
          values: { ...testLimits, perTradeUsdMicros: 2_000_000_000n },
          atMs: testNowMs + looseningWaitMs,
        },
      },
      removedAddresses: removed,
    });
  });

  it("hold nothing waiting for an agent with no change pending", async () => {
    const test = await startTestEngine();
    const settings = present(await test.stores.agents.get(testAgent, live));
    expect(agentGuardsOf(settings, [])).toMatchObject({
      sendLevel: { level: 0 },
      limits: { values: testLimits },
    });
    expect(agentGuardsOf(settings, [])).not.toHaveProperty("frozenAtMs");
    expect(agentGuardsOf(settings, []).sendLevel).not.toHaveProperty("pending");
    expect(agentGuardsOf(settings, []).limits).not.toHaveProperty("pending");
  });
});
