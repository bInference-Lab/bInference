import { err } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testCoin, testNowMs, testSwap } from "../intents/test-intents.js";
import { createdOrder, startOrderEngine, tapCard } from "../orders/test-orders.js";
import { createLiveFactsHandlers } from "./live-facts-handlers.js";
import { startTestEngine, testCall, testCallers, testChains } from "./test-engine.js";

describe("the live facts", () => {
  it("answer the agent's mode, balances, orders and spend against its caps in one read", async () => {
    const test = await startOrderEngine({ timeZone: "Asia/Shanghai" });
    const { handlers } = test.engine;
    const swap = expectOk(await handlers["intent/propose"](testCall(testSwap())));
    await tapCard(test, swap.intent, "confirm");
    const { order, intent } = await createdOrder(test);
    await tapCard(test, intent, "confirm");
    const facts = expectOk(
      await handlers["facts/get"](testCall({ agent: testAgent }, testCallers.runtime)),
    );
    expect(facts).toMatchObject({
      agent: testAgent,
      at: testNowMs,
      timeZone: "Asia/Shanghai",
      mode: "paper",
      frozen: false,
      approvalMode: "manual",
      sendLevel: 0,
      orders: [{ order, kind: "stopLoss", state: "active" }],
      perTradeUsdMicros: 1_000_000_000n,
      rollingDayUsdMicros: 5_000_000_000n,
    });
    expect(facts.spentTodayUsdMicros).toBeGreaterThan(0n);
    expect(facts.balances?.every((balance) => balance.paper)).toBe(true);
    expect(facts.balances?.map((balance) => balance.amount.asset)).toContain(testCoin);
    expect(Object.keys(facts.assets)).toContain(testCoin);
  });

  it("answer not_found for an agent the engine does not hold", async () => {
    const { engine } = await startTestEngine();
    const unknown = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000099" as never;
    expect(await engine.handlers["facts/get"](testCall({ agent: unknown }))).toStrictEqual(
      err("agent.not_found"),
    );
  });

  it("leave the balances out when they cannot be read now, and keep the rest", async () => {
    const test = await startTestEngine();
    const facts = createLiveFactsHandlers({
      agents: test.stores.agents,
      orders: test.stores.orders,
      intents: test.stores.intents,
      portfolio: async () => await Promise.resolve(err("chain.rpc_down")),
      chains: testChains(),
      clock: createManualClock(testNowMs),
      ownerTimeZone: () => "UTC",
    });
    const read = expectOk(await facts["facts/get"](testCall({ agent: testAgent })));
    expect(read).not.toHaveProperty("balances");
    expect(read).toMatchObject({ mode: "paper", orders: [], spentTodayUsdMicros: 0n });
  });
});
