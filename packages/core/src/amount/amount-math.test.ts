import { describe, expect, it } from "vitest";
import { BinferenceError } from "../errors/binference-error.js";
import { applyBps, mulDiv, splitByBps } from "./amount-math.js";
import { bpsSchema } from "./basis-points.js";

const bps = (value: number) => bpsSchema.parse(value);

describe("mulDiv", () => {
  it("rounds down or up only when the division is not exact", () => {
    const third = { numerator: 1n, denominator: 3n };
    expect(mulDiv(10n, third, "down")).toBe(3n);
    expect(mulDiv(10n, third, "up")).toBe(4n);
    expect(mulDiv(9n, third, "up")).toBe(3n);
  });

  it("keeps full precision on 256-bit amounts", () => {
    const max = 2n ** 256n - 1n;
    expect(mulDiv(max, { numerator: max, denominator: max }, "down")).toBe(max);
  });

  it("refuses a negative amount, a negative numerator and a zero denominator", () => {
    expect(() => mulDiv(-1n, { numerator: 1n, denominator: 1n }, "down")).toThrow(
      expect.objectContaining({ code: "core.negative_amount" }),
    );
    expect(() => mulDiv(1n, { numerator: -1n, denominator: 1n }, "down")).toThrow(BinferenceError);
    expect(() => mulDiv(1n, { numerator: 1n, denominator: 0n }, "up")).toThrow(
      expect.objectContaining({ code: "core.zero_denominator" }),
    );
  });
});

describe("applyBps", () => {
  it("takes 30 basis points of an amount in either direction", () => {
    expect(applyBps(10_001n, bps(30), "down")).toBe(30n);
    expect(applyBps(10_001n, bps(30), "up")).toBe(31n);
  });

  it("returns the whole at 10,000 basis points and nothing at zero", () => {
    expect(applyBps(123n, bps(10_000), "down")).toBe(123n);
    expect(applyBps(123n, bps(0), "up")).toBe(0n);
  });
});

describe("splitByBps", () => {
  it("rounds the part down and leaves every other unit in the rest", () => {
    expect(splitByBps(10_001n, bps(30))).toStrictEqual({ part: 30n, rest: 9_971n });
  });
});

describe("bpsSchema", () => {
  it.each([0, 50, 10_000])("accepts %d", (value) => {
    expect(bpsSchema.safeParse(value).success).toBe(true);
  });

  it.each([-1, 10_001, 0.5, Number.NaN])("refuses %d", (value) => {
    expect(bpsSchema.safeParse(value).success).toBe(false);
  });
});
