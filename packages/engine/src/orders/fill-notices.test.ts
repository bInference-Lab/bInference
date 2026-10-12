import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { fillNotice, priceText, skippedNotice } from "./fill-notices.js";
import { firstFillWaitMs, isNewReason, isWaiting, longestFillWaitMs } from "./fill-pacing.js";
import type { OrderFillReason, OrderFillRecord } from "./order-fill.js";
import { testStopLoss } from "./test-orders.js";

const order = {
  agentId: testAgent,
  kind: "stopLoss",
  isPaper: true,
  request: testStopLoss(),
} as const;
const ord = idSchema("ord").parse("ord_0190f1c2-3a4b-7c5d-8e6f-000000000001");

describe("a fill's notices", () => {
  it("writes a price to the cent from a cent up, and to two significant digits below", () => {
    expect(priceText({ numerator: 1_234_567n, denominator: 1n })).toBe("$1.23");
    expect(priceText({ numerator: 10_000n, denominator: 1n })).toBe("$0.01");
    expect(priceText({ numerator: 9_999n, denominator: 1n })).toBe("$0.0099");
    expect(priceText({ numerator: 15n, denominator: 2n })).toBe("$0.0000075");
    expect(priceText({ numerator: 1n, denominator: 10n ** 12n })).toBe("$0.0000000000000000010");
    expect(priceText({ numerator: 0n, denominator: 1n })).toBe("$0.00");
  });

  it("tells what a paper sale sold, for how many dollars and at what price", () => {
    const fill = {
      amountIn: { asset: testToken, base: 2_000_000n },
      amountOut: { asset: testCoin, base: 10n ** 15n },
      atMs: 1,
      soldPrice: { numerator: 4n, denominator: 5n },
    };
    expect(fillNotice(order, fill, { decimals: 6, assets: {} })).toStrictEqual({
      key: "notice.fill",
      agent: testAgent,
      values: { mode: "paper" },
      parts: {
        orderKind: { key: "order.kind", values: { kind: "stopLoss" } },
        result: {
          key: "fill.sell",
          values: { received: "$1.60", price: "$0.80" },
          amounts: { amount: fill.amountIn },
        },
      },
    });
  });

  it("tells a buy's dollars spent, and a live order's fill without the paper mark", () => {
    const buy = { ...order, isPaper: false, request: { ...testStopLoss(), side: "buy" as const } };
    const fill = {
      amountIn: { asset: testCoin, base: 10n ** 15n },
      amountOut: { asset: testToken, base: 0n },
      atMs: 1,
      soldPrice: { numerator: 600n, denominator: 10n ** 12n },
    };
    expect(fillNotice(buy, fill, { decimals: 6, assets: {} })).toMatchObject({
      values: { mode: "live" },
      parts: { result: { key: "fill.buy", values: { spent: "$0.60" } } },
    });
  });

  it("names a skip's reason, with the cap's use for the 24-hour cap", () => {
    const cap = { usedUsdMicros: 4_000_000_000n, capUsdMicros: 5_000_000_000n };
    expect(skippedNotice(order, { reason: "daily_cap", cap }).parts).toMatchObject({
      reason: { key: "reason.daily_cap", values: { used: "$4,000.00", cap: "$5,000.00" } },
    });
  });
});

// A row of the test order: a skip for a reason, or a fill, at a time.
function rowAt(atMs: number, reason?: OrderFillReason): OrderFillRecord {
  const id = idSchema("fil").parse(`fil_0190f1c2-3a4b-7c5d-8e6f-${String(atMs).padStart(12, "0")}`);
  return reason === undefined
    ? { id, orderId: ord, outcome: "filled", atMs }
    : { id, orderId: ord, outcome: "skipped", reason, atMs };
}

describe("the pace of an order's fills", () => {
  it("lets a buy wait 15 seconds after a skip, doubling to 5 minutes, and an exit never", () => {
    const buy = {
      request: {
        ...testStopLoss(),
        kind: "limit",
        side: "buy",
        trigger: { price: 1n, direction: "below" },
      },
    } as const;
    const skips = [3, 2, 1].map((n) => rowAt(n * 1_000, "no_route"));
    expect([
      isWaiting(buy, skips.slice(2), 1_000 + firstFillWaitMs - 1),
      isWaiting(buy, skips.slice(2), 1_000 + firstFillWaitMs),
    ]).toStrictEqual([true, false]);
    expect(isWaiting(buy, skips, 3_000 + 4 * firstFillWaitMs - 1)).toBe(true);
    const many = Array.from({ length: 9 }, () => rowAt(1_000, "no_route"));
    expect([
      isWaiting(buy, many, 1_000 + longestFillWaitMs - 1),
      isWaiting(buy, many, 1_000 + longestFillWaitMs),
    ]).toStrictEqual([true, false]);
    expect(isWaiting(buy, [rowAt(5), ...skips], 6)).toBe(false);
    expect(isWaiting({ request: testStopLoss() }, skips, 3_001)).toBe(false);
  });

  it("tells a skip's reason once in a row", () => {
    expect([
      isNewReason([], "no_route"),
      isNewReason([rowAt(1, "no_route")], "no_route"),
      isNewReason([rowAt(1, "venue_down")], "no_route"),
      isNewReason([rowAt(2), rowAt(1, "no_route")], "no_route"),
    ]).toStrictEqual([true, false, true, true]);
  });
});
