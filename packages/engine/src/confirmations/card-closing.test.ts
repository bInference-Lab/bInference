import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { testStopLoss } from "../orders/test-orders.js";
import { receiptLine } from "./card-closing.js";

const answeredBy = { surface: "console", by: "dev_1" } as const;

describe("receipt line", () => {
  it("names the surface and the time of a confirmation", () => {
    expect(receiptLine({ outcome: "confirmed", answeredBy, atMs: 5_000 })).toStrictEqual({
      key: "receipt.confirmed",
      values: {
        surface: { type: "choice", choice: "console" },
        time: { type: "time", atMs: 5_000 },
      },
    });
  });

  it("names the surface of a cancel", () => {
    expect(receiptLine({ outcome: "denied", answeredBy, atMs: 5_000 })).toStrictEqual({
      key: "receipt.denied",
      values: { surface: { type: "choice", choice: "console" } },
    });
  });

  it("becomes the paper fill's receipt for a confirmed paper intent, a line of its own", () => {
    const amountIn = { asset: assetRefSchema.parse("fake:1/slip44:1"), base: 5n };
    const amountOut = { asset: assetRefSchema.parse("fake:1/token:a"), base: 9n };
    const fill = { amountIn, amountOut };
    const confirmed = { outcome: "confirmed", answeredBy, atMs: 5_000 } as const;
    expect(receiptLine(confirmed, { kind: "paper", fill })).toStrictEqual({
      key: "receipt.paper",
      values: {
        result: {
          type: "line",
          line: {
            key: "receipt.result",
            values: {
              sold: { type: "amount", amount: amountIn },
              bought: { type: "amount", amount: amountOut },
            },
          },
        },
      },
    });
    expect(
      receiptLine({ outcome: "denied", answeredBy, atMs: 5_000 }, { kind: "paper", fill }).key,
    ).toBe("receipt.denied");
  });

  it("becomes how a confirmed live intent ended on chain, with its explorer link", () => {
    const amountIn = { asset: assetRefSchema.parse("fake:1/slip44:1"), base: 5n };
    const amountOut = { asset: assetRefSchema.parse("fake:1/token:a"), base: 9n };
    const fill = { amountIn, amountOut };
    const explorerLink = "https://scan.example.invalid/tx/0xab";
    const confirmed = { outcome: "confirmed", answeredBy, atMs: 5_000 } as const;
    const link = { type: "text", text: explorerLink };
    const lines = [
      receiptLine(confirmed, { kind: "filled", fill, explorerLink }),
      receiptLine(confirmed, { kind: "launched", token: amountOut.asset, fill, explorerLink }),
      receiptLine(confirmed, { kind: "launched", token: amountOut.asset, explorerLink }),
      receiptLine(confirmed, { kind: "failed", reason: "reverted", explorerLink }),
    ];
    expect(lines.map(({ key }) => key)).toStrictEqual([
      "receipt.filled",
      "receipt.launched",
      "receipt.launchedAlone",
      "receipt.failed",
    ]);
    expect(lines.map(({ values }) => values["explorerLink"])).toStrictEqual([
      link,
      link,
      link,
      link,
    ]);
    expect([lines[1]?.values["token"], lines[3]?.values["reason"]]).toStrictEqual([
      { type: "asset", asset: amountOut.asset },
      { type: "line", line: { key: "reason.reverted", values: {} } },
    ]);
  });

  it("becomes what a confirmed unfreeze or auto order took effect as, its mode named", () => {
    const confirmed = { outcome: "confirmed", answeredBy, atMs: 5_000 } as const;
    const order = {
      kind: "autoOrder",
      request: testStopLoss(),
      maxFills: 1,
      expiresAtMs: 9_000,
    } as const;
    const lines = [
      receiptLine(confirmed, { kind: "unfrozen", scope: "agent", agent: "main" }),
      receiptLine(confirmed, { kind: "unfrozen", scope: "install", agentCount: 2 }),
      receiptLine(confirmed, { kind: "orderActive", order, isPaper: true }),
      receiptLine(confirmed, { kind: "orderActive", order, isPaper: false }),
      receiptLine(confirmed, { kind: "orderUnstarted", why: "expired" }),
    ];
    expect(lines.map(({ key }) => key)).toStrictEqual([
      "receipt.unfrozenAgent",
      "receipt.unfrozenAll",
      "receipt.orderActive",
      "receipt.orderActive",
      "receipt.orderUnstarted",
    ]);
    expect([
      lines[0]?.values["agent"],
      lines[1]?.values["count"],
      lines[2]?.values["mode"],
      lines[3]?.values["mode"],
    ]).toStrictEqual([
      { type: "text", text: "main" },
      { type: "count", count: 2 },
      { type: "choice", choice: "paper" },
      { type: "choice", choice: "live" },
    ]);
    expect([lines[2]?.values["expiry"], lines[4]?.values["why"]]).toStrictEqual([
      { type: "dateTime", atMs: 9_000 },
      { type: "choice", choice: "expired" },
    ]);
  });

  it("says an expired card had no answer", () => {
    expect(receiptLine({ outcome: "expired", atMs: 5_000 })).toStrictEqual({
      key: "receipt.expired",
      values: {},
    });
  });
});
