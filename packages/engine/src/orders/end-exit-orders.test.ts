import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { testChains, type TestEngine } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import {
  endEmptyExit,
  endedExitsNotice,
  type ExitParts,
  exitEndMovesOf,
} from "./end-exit-orders.js";
import type { OrderRecord } from "./order-record.js";
import {
  createdOrder,
  startOrderEngine,
  storedOrder,
  tapCard,
  testStopLoss,
} from "./test-orders.js";

const live = { signal: new AbortController().signal };

async function confirmed(test: TestEngine, request: OrderRequest): Promise<OrderRecord> {
  const created = await createdOrder(test, request);
  await tapCard(test, created.intent, "confirm");
  return storedOrder(test, created.order);
}

// A take-profit, a stop-loss and a limit buy of the test token, each confirmed in turn.
async function threeOrders() {
  const test = await startOrderEngine();
  const takeProfit = await confirmed(test, {
    ...testStopLoss(),
    kind: "takeProfit",
    trigger: { price: 2_000_000n },
  });
  const stopLoss = await confirmed(test, testStopLoss());
  const buy = await confirmed(test, {
    ...testStopLoss(),
    kind: "limit",
    side: "buy",
    size: { usdMicros: 10_000_000n },
    trigger: { price: 500_000n, direction: "below" },
  });
  const pushes: EnginePush[] = [];
  const parts: ExitParts = {
    orders: test.stores.orders,
    chains: testChains(),
    publish: (push) => pushes.push(push),
  };
  const notices = () => pushes.filter(({ topic }) => topic === "notice").map(({ data }) => data);
  return { test, takeProfit, stopLoss, buy, parts, notices };
}

describe("exit orders on one position", () => {
  it("names the moves that end the other exit orders of a position an exit empties, and one notice", async () => {
    const { test, takeProfit, stopLoss, buy, parts } = await threeOrders();

    const moves = await exitEndMovesOf(parts, {
      emptiedBy: takeProfit,
      nowMs: testNowMs + 5,
      ...live,
    });
    const said = [
      endedExitsNotice(parts, { emptiedBy: takeProfit, count: moves.length }),
      endedExitsNotice(parts, { emptiedBy: takeProfit, count: 0 }),
    ];

    expect(moves).toStrictEqual([
      {
        id: stopLoss.id,
        expectedVersion: stopLoss.version,
        atMs: testNowMs + 5,
        state: "ended",
        endReason: "position_closed",
      },
    ]);
    expect((await storedOrder(test, buy.id)).state).toBe("active");
    expect((await storedOrder(test, stopLoss.id)).state).toBe("active");
    expect(said).toStrictEqual([
      {
        key: "notice.ordersEnded",
        agent: testAgent,
        values: { token: "TKN", count: "1" },
        parts: { orderKind: { key: "order.kind", values: { kind: "takeProfit" } } },
      },
      undefined,
    ]);
  });

  it("ends an exit order whose position a sale outside the exits emptied, once", async () => {
    const { stopLoss, buy, parts, notices } = await threeOrders();

    const ended = await endEmptyExit(parts, { order: stopLoss, nowMs: testNowMs + 5, ...live });
    const again = await endEmptyExit(parts, { order: stopLoss, nowMs: testNowMs + 6, ...live });
    const notExit = await endEmptyExit(parts, { order: buy, nowMs: testNowMs + 7, ...live });

    expect([ended?.state, ended?.endReason, again, notExit]).toStrictEqual([
      "ended",
      "position_closed",
      undefined,
      undefined,
    ]);
    expect(notices()).toMatchObject([{ key: "notice.exitEnded", values: { token: "TKN" } }]);
  });
});
