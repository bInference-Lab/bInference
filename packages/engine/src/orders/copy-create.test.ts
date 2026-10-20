import { accountRefSchema, assetRefParts } from "@binference/chain";
import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testNowMs, testToken } from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import { defaultOrderLifetimeMs } from "./order-rules.js";
import {
  createdOrder,
  startOrderEngine,
  storedOrder,
  tapCard,
  testCopy,
  testLeader,
} from "./test-orders.js";

const live = { signal: new AbortController().signal };
const chain = assetRefParts(testToken).chain;

describe("a copy order's creation", () => {
  it("stores the order with no fill limit, tracks its leader and starts its state on the tap", async () => {
    const test = await startOrderEngine();
    const created = await createdOrder(test, testCopy());
    const tracked = await test.stores.trackedWallets.tracked(chain, live);
    expect(tracked.map(({ account }) => account)).toStrictEqual([testLeader]);

    await tapCard(test, created.intent, "confirm");
    const order = await storedOrder(test, created.order);

    expect(order).toMatchObject({ kind: "copy", state: "active", fills: 0 });
    expect(order).not.toHaveProperty("maxFills");
    expect(order.expiresAtMs).toBe(testNowMs + defaultOrderLifetimeMs);
    expect(order.triggerState).toStrictEqual({
      sinceMs: testNowMs,
      through: 0,
      takes: 0,
      recent: [],
      retries: [],
      buys: [],
      held: [],
    });
  });

  it("refuses terms a copy order cannot keep, and a leader that is the agent's own wallet", async () => {
    const test = await startOrderEngine();
    const create = async (changes: Parameters<typeof testCopy>[0]) =>
      test.engine.handlers["order/create"](testCall(testCopy(changes)));
    const trigger = testCopy().trigger;
    const refusals: readonly NonNullable<Parameters<typeof testCopy>[0]>[] = [
      { side: "sell" },
      { token: testToken },
      { size: { usdMicros: 10_000_000n } },
      { worstPrice: 1_000_000n },
      { trigger: { ...trigger, dailyUsdMicros: 10_000_000n } },
      { trigger: { ...trigger, leader: accountRefSchema.parse("fake:2:0x00000009") } },
      { trigger: { ...trigger, leader: testAccount } },
      { expiresAt: testNowMs },
    ];

    const answers = await Promise.all(refusals.map(async (changes) => create(changes)));

    expect(answers).toStrictEqual(refusals.map(() => err("protocol.bad_args")));
    const waiting = await test.stores.orders.list(
      { states: ["awaiting_confirmation"], agentId: testAgent, limit: 10 },
      live,
    );
    expect(waiting).toStrictEqual([]);
  });

  it("refuses a live copy order while live fills are off", async () => {
    const test = await startOrderEngine({ agent: { mode: "live" } });

    expect(await test.engine.handlers["order/create"](testCall(testCopy()))).toStrictEqual(
      err("order.live_fills_off"),
    );
  });
});
