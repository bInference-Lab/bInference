import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { testCall, type TestEngine } from "../operations/test-engine.js";
import {
  createdOrder,
  startOrderEngine,
  storedOrder,
  tapCard,
  testStopLoss,
} from "./test-orders.js";

const live = { signal: new AbortController().signal };

async function freeze(test: TestEngine): Promise<void> {
  expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));
}

// The owner asks for the agent's unfreeze and taps Confirm on its card.
async function unfreeze(test: TestEngine): Promise<void> {
  const { intent } = expectOk(
    await test.engine.handlers["safety/unfreeze"](testCall({ agent: testAgent })),
  );
  if (intent === undefined) {
    throw new Error("Expected an unfreeze card.");
  }
  await tapCard(test, intent, "confirm");
}

async function activeOrders(test: TestEngine) {
  const query = { states: ["active"] as const, agentId: testAgent, limit: 10 };
  return test.stores.orders.list(query, live);
}

describe("auto orders under a freeze", () => {
  it("pauses the agent's active orders and cancels those waiting for their card", async () => {
    const test = await startOrderEngine();
    const active = await createdOrder(test);
    await tapCard(test, active.intent, "confirm");
    const waiting = await createdOrder(test);

    await freeze(test);

    expect((await storedOrder(test, active.order)).state).toBe("paused");
    expect((await storedOrder(test, waiting.order)).state).toBe("cancelled");
    expect((await test.stores.intents.get(waiting.intent, live))?.state).toBe("cancelled");
    expect(await activeOrders(test)).toStrictEqual([]);
    expect(
      test.pushes.filter(({ kind }) => kind === "order/changed").map(({ data }) => data),
    ).toMatchObject([{ state: "active" }, { state: "paused" }, { state: "cancelled" }]);
  });

  it("resumes the paused orders on the unfreeze's tap, and expires one past its expiry", async () => {
    const test = await startOrderEngine();
    const lasting = await createdOrder(test);
    const brief = await createdOrder(test, testStopLoss({ expiresAt: testNowMs + 60_000 }));
    await tapCard(test, lasting.intent, "confirm");
    await tapCard(test, brief.intent, "confirm");
    await freeze(test);
    await test.clock.advance(60_000);

    await unfreeze(test);

    expect((await storedOrder(test, lasting.order)).state).toBe("active");
    expect((await storedOrder(test, brief.order)).state).toBe("expired");
  });

  it("refuses a tap on an order's card once a freeze cancelled it", async () => {
    const test = await startOrderEngine();
    const waiting = await createdOrder(test);
    await freeze(test);
    const answeredBy = { surface: "telegram", by: "telegram" } as const;
    const answer = {
      intent: waiting.intent,
      decision: "confirm",
      cardVersion: 1,
      answeredBy,
    } as const;

    const late = expectOk(await test.engine.answer(answer, live));

    expect(late.outcome.verdict).toBe("closed");
    expect((await storedOrder(test, waiting.order)).state).toBe("cancelled");
    expect(await activeOrders(test)).toStrictEqual([]);
  });

  it("cancels a waiting order a freeze's read missed, tapped or not, with its card", async () => {
    const test = await startOrderEngine();
    const untapped = await createdOrder(test);
    const tapped = await createdOrder(test);
    // The agent froze in a write that read the orders before these two were stored.
    test.stores.agents.freezeNow([{ agentId: testAgent, expectedVersion: 0 }], {
      atMs: testNowMs,
      isFrozen: true,
    });

    await tapCard(test, tapped.intent, "confirm");
    await test.engine.tickOrders(live);

    expect((await storedOrder(test, tapped.order)).state).toBe("cancelled");
    expect((await storedOrder(test, untapped.order)).state).toBe("cancelled");
    expect((await test.stores.intents.get(untapped.intent, live))?.state).toBe("cancelled");
    expect(await activeOrders(test)).toStrictEqual([]);
  });
});
