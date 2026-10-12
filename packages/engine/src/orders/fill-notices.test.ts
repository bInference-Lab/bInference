import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testToken } from "../intents/test-intents.js";
import { fillNotice, priceText, skippedNotice } from "./fill-notices.js";
import { createFillPacing, firstFillWaitMs, longestFillWaitMs } from "./fill-pacing.js";
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
    expect(fillNotice(order, fill, 6)).toStrictEqual({
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
    expect(fillNotice(buy, fill, 6)).toMatchObject({
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

describe("the pace of an order's fills", () => {
  it("waits 15 seconds after a skip, doubling to 5 minutes, and tells each reason once in a row", () => {
    const pacing = createFillPacing();
    const heard = [
      pacing.skipped(ord, "engine_locked", 0),
      pacing.skipped(ord, "engine_locked", firstFillWaitMs),
      pacing.skipped(ord, "no_route", 10 * firstFillWaitMs),
    ];
    const waits = [
      pacing.isWaiting(ord, 10 * firstFillWaitMs + 59_999),
      pacing.isWaiting(ord, 10 * firstFillWaitMs + 60_000),
    ];
    Array.from({ length: 8 }, (_, step) => pacing.skipped(ord, "no_route", step));
    const capped = pacing.isWaiting(ord, 7 + longestFillWaitMs);
    pacing.settled(ord);

    expect(heard).toStrictEqual([true, false, true]);
    expect(waits).toStrictEqual([true, false]);
    expect(capped).toBe(false);
    expect([pacing.isWaiting(ord, 0), pacing.skipped(ord, "no_route", 0)]).toStrictEqual([
      false,
      true,
    ]);
  });
});
