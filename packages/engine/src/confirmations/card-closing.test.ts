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

  it("says an expired card had no answer", () => {
    expect(receiptLine({ outcome: "expired", atMs: 5_000 })).toStrictEqual({
      key: "receipt.expired",
      values: {},
    });
  });
});
