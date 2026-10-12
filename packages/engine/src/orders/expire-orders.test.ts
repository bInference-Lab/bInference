import { describe, expect, it } from "vitest";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import { moveOrder } from "./order-machine.js";
import {
  createdOrder,
  startOrderEngine,
  storedOrder,
  tapCard,
  testStopLoss,
} from "./test-orders.js";

const live = { signal: new AbortController().signal };
const hourMs = 3_600_000;

function expiringNotices(test: TestEngine) {
  return test.pushes
    .filter(({ topic }) => topic === "notice")
    .map(({ data }) => data)
    .filter((data) => JSON.stringify(data).includes("notice.orderExpiring"));
}

describe("an auto order's expiry", () => {
  it("expires an active order at its time, which never fills after", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test, testStopLoss({ expiresAt: testNowMs + 60_000 }));
    await tapCard(test, view.intent, "confirm");
    await test.clock.advance(59_999);
    await test.engine.tickOrders(live);
    const before = await storedOrder(test, view.order);

    await test.clock.advance(1);
    await test.engine.tickOrders(live);

    expect(before.state).toBe("active");
    expect(moveOrder(before, { type: "fill_recorded" }, testNowMs + 60_000)).toStrictEqual({
      ok: false,
      error: "expired",
    });
    expect((await storedOrder(test, view.order)).state).toBe("expired");
  });

  it("expires an order still waiting for its card at its own expiry, and closes the card", async () => {
    const test = await startOrderEngine();
    const view = await createdOrder(test, testStopLoss({ expiresAt: testNowMs + 60_000 }));

    await test.clock.advance(60_000);
    await test.engine.tickOrders(live);

    expect((await storedOrder(test, view.order)).state).toBe("expired");
    expect((await test.stores.intents.get(view.intent, live))?.state).toBe("cancelled");
  });

  it("warns once, a day before an active order ends", async () => {
    const test = await startOrderEngine();
    const expiresAt = testNowMs + 25 * hourMs;
    const view = await createdOrder(test, testStopLoss({ expiresAt }));
    await tapCard(test, view.intent, "confirm");
    await test.engine.tickOrders(live);
    const early = expiringNotices(test);

    await test.clock.advance(hourMs);
    await test.engine.tickOrders(live);
    await test.clock.advance(hourMs);
    await test.engine.tickOrders(live);

    expect(early).toStrictEqual([]);
    expect(expiringNotices(test)).toStrictEqual([
      {
        key: "notice.orderExpiring",
        agent: testAgent,
        values: {},
        times: { when: expiresAt },
        parts: { orderKind: { key: "order.kind", values: { kind: "stopLoss" } } },
      },
    ]);
    expect((await storedOrder(test, view.order)).expiryNoticedAtMs).toBe(testNowMs + hourMs);
  });
});
