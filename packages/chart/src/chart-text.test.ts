import { describe, expect, it } from "vitest";
import { chartTextLines } from "./chart-text.js";

describe("chartTextLines", () => {
  it("writes a pie as its title and a line per slice", () => {
    expect(
      chartTextLines({
        chartType: "pie",
        title: "Holdings",
        segments: [
          { label: "BNB", value: 62.5 },
          { label: "USDT", value: 37.5 },
        ],
      }),
    ).toStrictEqual(["Holdings (pie chart)", "- BNB: 62.5", "- USDT: 37.5"]);
  });

  it("writes series with their axes and each category's value", () => {
    expect(
      chartTextLines({
        chartType: "line",
        title: "Price",
        categories: ["12:00", "13:00"],
        series: [{ name: "BNB", values: [612.4, 615] }],
        xLabel: "Hour",
        yLabel: "USD",
      }),
    ).toStrictEqual([
      "Price (line chart)",
      "X axis: Hour",
      "Y axis: USD",
      "- BNB: 12:00: 612.4; 13:00: 615",
    ]);
  });
});
