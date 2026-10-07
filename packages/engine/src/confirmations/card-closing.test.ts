import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
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
    expect(receiptLine(confirmed, fill)).toStrictEqual({
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
    expect(receiptLine({ outcome: "denied", answeredBy, atMs: 5_000 }, fill).key).toBe(
      "receipt.denied",
    );
  });

  it("says an expired card had no answer", () => {
    expect(receiptLine({ outcome: "expired", atMs: 5_000 })).toStrictEqual({
      key: "receipt.expired",
      values: {},
    });
  });
});
