import { bpsSchema, err } from "@binference/core";
import type { OrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testLimits, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { testRuleRequest } from "../webhooks/test-webhook-rules.js";
import { expiryLimitRefusal } from "./expiry-limit-refusal.js";
import { createdOrder, startOrderEngine, testCopy, testStopLoss } from "./test-orders.js";

// Decision 0364: an order's own end lies no further ahead than the agent's order expiry days.

const live = { signal: new AbortController().signal };
const dayMs = 86_400_000;
const limits = { ...testLimits, orderExpiryDays: 7 };
const atLimit = testNowMs + 7 * dayMs;

const everyKind: readonly (readonly [string, OrderRequest])[] = [
  ["limit", { ...testStopLoss(), kind: "limit", trigger: { price: 800_000n, direction: "below" } }],
  ["take-profit", { ...testStopLoss(), kind: "takeProfit", trigger: { price: 1_200_000n } }],
  ["stop-loss", testStopLoss()],
  [
    "trailing",
    { ...testStopLoss(), kind: "trailing", trigger: { distanceBps: bpsSchema.parse(500) } },
  ],
  [
    "DCA",
    {
      ...testStopLoss(),
      kind: "dca",
      side: "buy",
      size: { usdMicros: 1_000_000n },
      trigger: { cron: "0 9 * * *" },
    },
  ],
  ["copy", testCopy()],
];

describe("the order expiry limit", () => {
  it("passes no end, an end at the limit and one before it", () => {
    const context = { nowMs: testNowMs, expiryDays: 7 };
    expect(expiryLimitRefusal({}, context)).toBeUndefined();
    expect(expiryLimitRefusal({ expiresAt: atLimit }, context)).toBeUndefined();
    expect(expiryLimitRefusal({ expiresAt: testNowMs + 60_000 }, context)).toBeUndefined();
  });

  it("refuses an end past the limit with its own code", () => {
    const context = { nowMs: testNowMs, expiryDays: 7 };
    expect(expiryLimitRefusal({ expiresAt: atLimit + 1 }, context)).toBe("order.expiry_limit");
  });

  it.each(everyKind)(
    "refuses a %s order that names an end past the limit, storing nothing",
    async (_kind, request) => {
      const test = await startOrderEngine({ agent: { limits } });
      const create = test.engine.handlers["order/create"];

      expect(await create(testCall({ ...request, expiresAt: atLimit + 1 }))).toStrictEqual(
        err("order.expiry_limit"),
      );
      const waiting = { states: ["awaiting_confirmation" as const], limit: 5 };
      expect(await test.stores.orders.list(waiting, live)).toStrictEqual([]);
      expect((await createdOrder(test, { ...request, expiresAt: atLimit })).expiresAt).toBe(
        atLimit,
      );
    },
  );

  it("leaves a webhook rule its 30 days, whatever the order expiry days", async () => {
    const test = await startOrderEngine({ agent: { limits } });
    const request = testRuleRequest({ expiresAt: testNowMs + 20 * dayMs });

    const created = await test.engine.handlers["webhookRule/create"](testCall(request));

    expect(created.ok).toBe(true);
  });
});
