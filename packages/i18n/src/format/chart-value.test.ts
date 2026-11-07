import { describe, expect, it } from "vitest";
import { formatChartValue } from "./chart-value.js";

describe("formatChartValue", () => {
  it("writes small values with up to 4 decimals and large ones in the compact form", () => {
    expect(formatChartValue(612.4)).toBe("612.4");
    expect(formatChartValue(0.000_123_4)).toBe("0.0001");
    expect(formatChartValue(12_500)).toBe("12.5K");
    expect(formatChartValue(-3_200_000)).toBe("-3.2M");
  });
});
