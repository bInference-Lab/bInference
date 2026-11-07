import { describe, expect, it } from "vitest";
import { chartLayout } from "./chart-layout.js";

const size = { width: 400, height: 200 };

describe("chartLayout", () => {
  it("lays bars out from zero, side by side per series, with whole value ticks", () => {
    const layout = chartLayout(
      {
        chartType: "bar",
        title: "Volume",
        categories: ["Mon", "Tue"],
        series: [
          { name: "Buys", values: [3, 7] },
          { name: "Sales", values: [5, 1] },
        ],
      },
      size,
    );
    expect(layout.yMarks.map((mark) => mark.value)).toStrictEqual([0, 2, 4, 6, 8]);
    expect(layout.yMarks[0]?.at).toBe(layout.plot.bottom);
    expect(layout.marks).toHaveLength(4);
    expect(layout.marks.every((mark) => mark.kind === "bar")).toBe(true);
    expect(layout.legend).toStrictEqual(["Buys", "Sales"]);
    expect(layout.xMarks.map((mark) => mark.label)).toStrictEqual(["Mon", "Tue"]);
  });

  it("keeps a line's range to its values, and thins long category labels to eight or fewer", () => {
    const categories = Array.from({ length: 24 }, (_hour, index) => `${String(index)}:00`);
    const layout = chartLayout(
      {
        chartType: "line",
        title: "Price",
        categories,
        series: [{ name: "BNB", values: categories.map((_c, index) => 600 + index) }],
      },
      size,
    );
    expect(layout.yMarks[0]?.value).toBe(600);
    expect(layout.xMarks.length).toBeLessThanOrEqual(8);
    expect(layout.marks).toMatchObject([{ kind: "line", series: 0 }]);
  });

  it("lays an area out down to zero, and a flat series within a range", () => {
    const area = chartLayout(
      {
        chartType: "area",
        title: "Value",
        categories: ["a", "b"],
        series: [{ name: "x", values: [-2, 4] }],
      },
      size,
    );
    expect(area.marks).toMatchObject([{ kind: "area", base: expect.any(Number) as number }]);
    const flat = chartLayout(
      { chartType: "line", title: "Flat", categories: ["a"], series: [{ name: "x", values: [5] }] },
      size,
    );
    expect(flat.yMarks.length).toBeGreaterThan(1);
  });

  it("lays a pie out as slices around the middle", () => {
    const layout = chartLayout(
      {
        chartType: "pie",
        title: "Holdings",
        segments: [
          { label: "BNB", value: 3 },
          { label: "USDT", value: 1 },
        ],
      },
      size,
    );
    expect(layout.marks).toHaveLength(2);
    expect(layout.marks[0]).toMatchObject({
      kind: "slice",
      series: 0,
      path: expect.stringMatching(/^M 200 100 L 200 8 A 92 92 0 1 1 /) as string,
    });
    expect(layout.legend).toStrictEqual(["BNB", "USDT"]);
  });
});
