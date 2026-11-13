import { err, idSchema } from "@binference/core";
import { disclaimerVersion } from "@binference/i18n";
import { describe, expect, it, vi } from "vitest";
import { fixtureId, inOrder } from "../contracts/store-fixtures.js";
import { createMemoryQuotaSource } from "../fakes/memory-quota-source.js";
import { expectOk, testAgent, testAgentDraft, testSwap } from "../intents/test-intents.js";
import { type TestEngine, testCall, testCallers } from "../operations/test-engine.js";
import { startOrderEngine, testStopLoss } from "../orders/test-orders.js";
import { testRuleRequest } from "../webhooks/test-webhook-rules.js";
import type { QuotaCall, Quotas } from "./quotas.js";
import { rateWindowMs } from "./rate-room.js";

// Decision 0431: work past a quota is refused before anything is stored.

const live = { signal: new AbortController().signal };
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");

async function engineWithin(quotas: Quotas): Promise<TestEngine> {
  return startOrderEngine({ quotas: createMemoryQuotaSource(quotas) });
}

// The quota each store call carried, -1 for none.
function quotasOf(calls: readonly (readonly [unknown, QuotaCall])[]): readonly number[] {
  return calls.map(([, call]) => call.quota ?? -1);
}

async function intentsOf(test: TestEngine) {
  return test.stores.intents.createdSince({ agentId: testAgent, fromMs: 0 }, live);
}

async function propose(test: TestEngine) {
  return test.engine.handlers["intent/propose"](testCall(testSwap()));
}

async function startTurn(test: TestEngine, n: number) {
  const turn = fixtureId("trn", n);
  const args = { agent: testAgent, session, turn, messages: [], outsideContent: false };
  return test.engine.handlers["turn/start"](testCall(args, testCallers.runtime));
}

async function charged(test: TestEngine, n: number): Promise<void> {
  const turn = fixtureId("trn", n);
  const at = { agent: testAgent, turn, key: `${turn}.usage.1`, model: "m" };
  const tokens = { inputTokens: 1, outputTokens: 1, cachedTokens: 0, usdMicros: 1n };
  await test.stores.modelUsage.record({ ...at, ...tokens, atMs: test.clock.now() }, live);
}

describe("the proposal quota", () => {
  it("refuses a proposal past the agent's minute, storing nothing, and lets one in after", async () => {
    const test = await engineWithin({ proposalsPerMinute: 1 });
    expectOk(await propose(test));
    const startedAt = test.clock.now();
    await expect(propose(test)).rejects.toMatchObject({
      code: "quota.proposals",
      retryable: true,
      details: { resumesAt: startedAt + rateWindowMs },
    });
    expect(await intentsOf(test)).toHaveLength(1);
    await test.clock.advance(rateWindowMs);
    expectOk(await propose(test));
  });

  it("refuses an auto order past the agent's minute before anything is stored", async () => {
    const test = await engineWithin({ proposalsPerMinute: 0 });
    await expect(
      test.engine.handlers["order/create"](testCall(testStopLoss())),
    ).rejects.toMatchObject({ code: "quota.proposals" });
    const waiting = { states: ["awaiting_confirmation" as const], limit: 5 };
    expect(await test.stores.orders.list(waiting, live)).toStrictEqual([]);
  });

  it("refuses a webhook rule past the agent's minute before anything is stored", async () => {
    const test = await engineWithin({ proposalsPerMinute: 0 });
    await expect(
      test.engine.handlers["webhookRule/create"](testCall(testRuleRequest())),
    ).rejects.toMatchObject({ code: "quota.proposals" });
    const rules = { states: ["awaiting_confirmation", "active"] as const, limit: 5 };
    expect(await test.stores.webhookRules.list(rules, live)).toStrictEqual([]);
    expect(await intentsOf(test)).toStrictEqual([]);
  });

  it("leaves a frozen agent's refusals as they were", async () => {
    const test = await engineWithin({ proposalsPerMinute: 0 });
    const frozen = { atMs: test.clock.now(), isFrozen: true };
    expectOk(test.stores.agents.freezeNow([{ agentId: testAgent, expectedVersion: 0 }], frozen));
    const create = test.engine.handlers["order/create"];
    expect(await create(testCall(testStopLoss()))).toStrictEqual(err("agent.frozen"));
    const proposed = expectOk(await propose(test));
    expect([proposed.state, proposed.outcome?.reason]).toStrictEqual(["rejected_policy", "frozen"]);
  });
});

describe("the open orders' quota", () => {
  it("refuses an order past the agent's open orders, storing no order and no card", async () => {
    const test = await engineWithin({ openOrders: 1 });
    const create = test.engine.handlers["order/create"];
    expectOk(await create(testCall(testStopLoss())));
    expect(await create(testCall(testStopLoss()))).toStrictEqual(err("quota.orders"));
    const open = { states: ["awaiting_confirmation" as const], limit: 5 };
    expect(await test.stores.orders.list(open, live)).toHaveLength(1);
    expect(await intentsOf(test)).toHaveLength(1);
  });
});

describe("the live agents' quota", () => {
  it("refuses a second live agent and keeps the agent on paper", async () => {
    const test = await engineWithin({ liveAgents: 1 });
    const other = testAgentDraft({ id: fixtureId("agt", 8), name: "other", mode: "live" });
    expectOk(await test.stores.agents.create(other, live));
    const accepted = { agent: testAgent, disclaimer: disclaimerVersion };
    const goLive = test.engine.handlers["agent/goLive"];
    expect(await goLive(testCall(accepted))).toStrictEqual(err("quota.live_agents"));
    expect((await test.stores.agents.get(testAgent, live))?.agent.mode).toBe("paper");
  });
});

describe("the turn quota", () => {
  it("refuses a turn past the agent's minute, naming when the next may start", async () => {
    const test = await engineWithin({ turnsPerMinute: 1 });
    expectOk(await startTurn(test, 1));
    await charged(test, 1);
    expectOk(
      await test.engine.handlers["turn/end"](
        testCall(
          { agent: testAgent, turn: fixtureId("trn", 1), outcome: "ok" },
          testCallers.runtime,
        ),
      ),
    );
    await expect(startTurn(test, 2)).rejects.toMatchObject({
      code: "quota.turns",
      retryable: true,
      details: { resumesAt: test.clock.now() + rateWindowMs },
    });
    expect(test.turns.runningOf(testAgent)).toBeUndefined();
  });
});

describe("an engine with no quota", () => {
  it("counts no proposal, order, live agent or turn", async () => {
    const test = await startOrderEngine();
    const createdSince = vi.spyOn(test.stores.intents, "createdSince");
    const turnsSince = vi.spyOn(test.stores.modelUsage, "turnsSince");
    const ordersCreate = vi.spyOn(test.stores.orders, "create");
    const setMode = vi.spyOn(test.stores.agents, "setMode");
    await inOrder([1, 2, 3, 4, 5, 6, 7, 8], async () => {
      expectOk(await propose(test));
      expectOk(await test.engine.handlers["order/create"](testCall(testStopLoss())));
    });
    expectOk(await startTurn(test, 1));
    const accepted = { agent: testAgent, disclaimer: disclaimerVersion };
    expectOk(await test.engine.handlers["agent/goLive"](testCall(accepted)));
    expect(createdSince).not.toHaveBeenCalled();
    expect(turnsSince).not.toHaveBeenCalled();
    expect(quotasOf(ordersCreate.mock.calls)).toStrictEqual(Array.from({ length: 8 }, () => -1));
    expect(quotasOf(setMode.mock.calls)).toStrictEqual([-1]);
  });
});
