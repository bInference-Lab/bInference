import { describe, expect, it } from "vitest";
import { portableChartSchema } from "./portable-chart.schema.js";

const bars = {
  chartType: "bar",
  title: "Volume",
  categories: ["Mon", "Tue"],
  series: [{ name: "Buys", values: [3, 4] }],
} as const;

describe("a portable chart", () => {
  it("takes series over categories that each have their own label", () => {
    expect(portableChartSchema.safeParse(bars).success).toBe(true);
  });

  it.each([
    ["two categories with one label", { ...bars, categories: ["Mon", "Mon"] }],
    [
      "two series with one name",
      {
        ...bars,
        series: [
          { name: "Buys", values: [3, 4] },
          { name: "Buys", values: [1, 2] },
        ],
      },
    ],
    ["a series short of a value", { ...bars, series: [{ name: "Buys", values: [3] }] }],
  ] as const)("refuses %s", (_case, chart) => {
    expect(portableChartSchema.safeParse(chart).success).toBe(false);
  });
});
