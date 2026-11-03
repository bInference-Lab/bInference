import { describe, expect, it } from "vitest";
import { baseUnitsOf } from "./base-units.js";

describe("baseUnitsOf", () => {
  it("reads typed decimal text as base units without a float", () => {
    expect(baseUnitsOf("0.002", 18)).toBe(2_000_000_000_000_000n);
    expect(baseUnitsOf("12.5", 6)).toBe(12_500_000n);
    expect(baseUnitsOf("25", 2)).toBe(2_500n);
  });

  it("refuses text that is no decimal, or has more decimals than the asset", () => {
    expect(baseUnitsOf("", 6)).toBeUndefined();
    expect(baseUnitsOf("1,5", 6)).toBeUndefined();
    expect(baseUnitsOf("-1", 6)).toBeUndefined();
    expect(baseUnitsOf("0.001", 2)).toBeUndefined();
  });
});
