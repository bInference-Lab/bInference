import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { decimalText } from "./decimal-text.js";
import { formatPercent, formatTokenAmount, formatUsd } from "./format-amount.js";

const ether = 10n ** 18n;

describe("decimalText", () => {
  it.each([
    [1_500_000_000_000_000_000n, 18, "1.5"],
    [312_400_000n, 6, "312.4"],
    [5n, 18, "0.000000000000000005"],
    [42n, 0, "42"],
    [0n, 18, "0"],
    [-1_250_000n, 6, "-1.25"],
  ])("writes %s base units with %s decimals as %s", (amountBase, decimals, text) => {
    expect(decimalText(amountBase, decimals)).toBe(text);
  });

  it.each([-1, 1.5, Number.NaN])("refuses %s decimals", (decimals) => {
    expect(() => decimalText(1n, decimals)).toThrow(
      expect.objectContaining({ code: "i18n.bad_decimals" }),
    );
  });
});

describe("formatTokenAmount", () => {
  it.each([
    [ether / 2n, "0.5"],
    [312_400_123_000_000_000_000n, "312.4"],
    [313_950_000_000_000_000_000n, "313.95"],
    [1_234_567_891_000_000_000_000_000n, "1,234,567"],
    [123_456_789_000_000n, "0.000123456"],
    [0n, "0"],
  ])("shows %s base units of an 18-decimal token as %s", (amountBase, text) => {
    expect(formatTokenAmount(amountBase, 18)).toBe(text);
  });

  it("cuts toward zero instead of rounding up", () => {
    expect(formatTokenAmount(9_999_999n, 6)).toBe("9.99999");
    expect(formatTokenAmount(-9_999_999n, 6)).toBe("-9.99999");
  });
});

describe("formatUsd", () => {
  it.each([
    [612_400_000n, "$612.40"],
    [1_234_567_005_000n, "$1,234,567.01"],
    [10_000n, "$0.01"],
    [0n, "$0.00"],
    [-1_200_000n, "-$1.20"],
  ])("shows %s micro-dollars as %s", (usdMicros, text) => {
    expect(formatUsd(usdMicros)).toBe(text);
  });

  it.each([
    [4_000n, "<$0.01"],
    [9_999n, "<$0.01"],
    [1n, "<$0.01"],
    [-4_000n, "-<$0.01"],
  ])("shows %s micro-dollars, under a cent, as %s", (usdMicros, text) => {
    expect(formatUsd(usdMicros)).toBe(text);
  });
});

describe("formatPercent", () => {
  it.each([
    [8, "0.08%"],
    [50, "0.50%"],
    [500, "5.00%"],
    [10_000, "100.00%"],
    [0, "0.00%"],
  ])("shows %s basis points as %s", (rate, text) => {
    expect(formatPercent(bpsSchema.parse(rate))).toBe(text);
  });
});
