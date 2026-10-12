import { describe, expect, it } from "vitest";
import { testNowMs, testSwap } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import {
  createdOrder,
  startOrderEngine,
  storedOrder,
  testStopLoss,
} from "../orders/test-orders.js";

const live = { signal: new AbortController().signal };

async function proposedSwap(test: TestEngine) {
  const answer = await test.engine.handlers["intent/propose"](testCall(testSwap()));
  if (!answer.ok || answer.value.card === undefined) {
    throw new Error("Expected an intent with a card.");
  }
  return { intent: answer.value.intent, card: answer.value.card.card };
}

function closedCards(test: TestEngine) {
  return test.pushes.filter(({ kind }) => kind === "card/closed").map(({ data }) => data);
}

describe("the card timer", () => {
  it("answers when the open card's time is up, and leaves the card open before it", async () => {
    const test = await startTestEngine();
    const { intent } = await proposedSwap(test);

    const next = await test.engine.expireCards(live);
    await test.clock.advance(59_999);
    const later = await test.engine.expireCards(live);

    expect([next, later]).toStrictEqual([testNowMs + 60_000, testNowMs + 60_000]);
    expect((await test.stores.intents.get(intent, live))?.state).toBe("awaiting_confirmation");
    expect(closedCards(test)).toStrictEqual([]);
  });

  it("expires a trade's card at its time with no tap, and closes it into its receipt", async () => {
    const test = await startTestEngine();
    const { intent, card } = await proposedSwap(test);

    await test.clock.advance(60_000);
    const next = await test.engine.expireCards(live);

    expect(next).toBeUndefined();
    expect((await test.stores.intents.get(intent, live))?.state).toBe("expired");
    expect(closedCards(test)).toStrictEqual([{ intent, card, reason: "expired" }]);
  });

  it("expires a card whose time ran out while the engine was stopped on its first run", async () => {
    const test = await startTestEngine();
    const first = await proposedSwap(test);
    await test.clock.advance(30_000);
    const second = await proposedSwap(test);

    await test.clock.advance(3_600_000);
    await test.engine.expireCards(live);

    const states = await Promise.all(
      [first.intent, second.intent].map(async (id) => test.stores.intents.get(id, live)),
    );
    expect(states.map((record) => record?.state)).toStrictEqual(["expired", "expired"]);
  });

  it("answers the soonest of several open cards", async () => {
    const test = await startTestEngine();
    await proposedSwap(test);
    await test.clock.advance(20_000);
    await proposedSwap(test);

    expect(await test.engine.expireCards(live)).toBe(testNowMs + 60_000);
    await test.clock.advance(40_000);
    expect(await test.engine.expireCards(live)).toBe(testNowMs + 80_000);
  });

  it("expires an auto order's card with its order at the card's time", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test, testStopLoss());
    const openedAtMs = test.clock.now();
    const cardExpiry = await test.engine.expireCards(live);

    await test.clock.advance(10 * 60_000);
    await test.engine.expireCards(live);

    expect(cardExpiry).toBe(openedAtMs + 10 * 60_000);
    expect((await test.stores.intents.get(view.intent, live))?.state).toBe("expired");
    expect((await storedOrder(test, view.order)).state).toBe("expired");
  });
});
