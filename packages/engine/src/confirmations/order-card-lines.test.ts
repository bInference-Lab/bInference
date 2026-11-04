import { bpsSchema } from "@binference/core";
import type { DcaOrderRequest, LimitOrderRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testCopy, testStopLoss } from "../orders/test-orders.js";
import { orderSummaryLine } from "./order-card-lines.js";

const token = { type: "asset", asset: testToken } as const;
const firstRuns = [testNowMs + 60_000, testNowMs + 120_000] as const;

const limitBuy: LimitOrderRequest = {
  ...testStopLoss(),
  kind: "limit",
  side: "buy",
  size: { usdMicros: 5_000_000n },
  trigger: { price: 800_000n, direction: "below" },
};

const dca: DcaOrderRequest = {
  ...testStopLoss(),
  kind: "dca",
  side: "buy",
  spend: testCoin,
  size: { usdMicros: 10_000_000n },
  trigger: { cron: "*/5 * * * *" },
};

const lineOf = (line: ReturnType<typeof orderSummaryLine>, name: string) => line.values[name];

describe("an auto order's summary line", () => {
  it("says a sale sells a dollar value of its token", () => {
    const sale = testStopLoss({ size: { usdMicros: 3_000_000n } });
    expect(lineOf(orderSummaryLine(sale), "sell")).toStrictEqual({
      type: "line",
      line: {
        key: "card.order.sell",
        values: {
          size: { type: "choice", choice: "usd" },
          usd: { type: "usd", usdMicros: 3_000_000n },
          token,
        },
      },
    });
  });

  it("says a limit sale sells an amount of its token when its price is met", () => {
    const sale: LimitOrderRequest = {
      ...limitBuy,
      side: "sell",
      size: { base: 7_000_000n },
      trigger: { price: 1_200_000n, direction: "above" },
    };
    expect(orderSummaryLine(sale)).toStrictEqual({
      key: "card.order.summary.limitSell",
      values: {
        sell: {
          type: "line",
          line: {
            key: "card.order.sell",
            values: {
              size: { type: "choice", choice: "other" },
              amount: { type: "amount", amount: { asset: testToken, base: 7_000_000n } },
            },
          },
        },
        condition: {
          type: "line",
          line: {
            key: "card.order.condition",
            values: {
              direction: { type: "choice", choice: "above" },
              price: { type: "usd", usdMicros: 1_200_000n },
            },
          },
        },
      },
    });
  });

  it("says a buy stored before it named what it spends spends its dollars alone", () => {
    expect(lineOf(orderSummaryLine(limitBuy), "spend")).toStrictEqual({
      type: "line",
      line: {
        key: "card.order.spend",
        values: {
          size: { type: "choice", choice: "usdOnly" },
          usd: { type: "usd", usdMicros: 5_000_000n },
        },
      },
    });
  });

  it("faults on a buy sized by share that names nothing to spend, which no card may draw", () => {
    const shared = { ...limitBuy, size: { percentBps: bpsSchema.parse(5_000) } };
    expect(() => orderSummaryLine(shared)).toThrow(
      expect.objectContaining({ code: "engine.bad_document" }),
    );
  });

  it("runs a DCA order in UTC with no count when its request names neither", () => {
    const line = orderSummaryLine(dca, { firstRuns });
    expect(lineOf(line, "count")).toStrictEqual({ type: "count", count: 0 });
    expect(lineOf(line, "schedule")).toMatchObject({
      line: { values: { zone: { type: "text", text: "UTC" } } },
    });
  });

  it("counts a DCA order's times by its most fills when it names no count", () => {
    const line = orderSummaryLine({ ...dca, maxFills: 4 }, { firstRuns });
    expect(lineOf(line, "count")).toStrictEqual({ type: "count", count: 4 });
  });

  it("faults on a DCA order's card drawn without its first runs", () => {
    expect(() => orderSummaryLine(dca)).toThrow(
      expect.objectContaining({ code: "engine.bad_document" }),
    );
  });

  it("names the token a copy order that names nothing to spend spends", () => {
    const { spend: _spend, ...unspent } = testCopy();
    expect(lineOf(orderSummaryLine(unspent), "spend")).toStrictEqual({
      type: "asset",
      asset: testCoin,
    });
  });
});
