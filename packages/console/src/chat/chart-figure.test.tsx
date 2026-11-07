// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChartFigure } from "./chart-figure";

afterEach(cleanup);

describe("a chart in the console", () => {
  it("draws bars with value ticks, category labels and a legend, its words as text", () => {
    const { container } = render(
      <ChartFigure
        chart={{
          chartType: "bar",
          title: "Volume <b>",
          categories: ["Mon", "Tue"],
          series: [
            { name: "Buys", values: [3, 12_000] },
            { name: "Sales", values: [5, 1] },
          ],
        }}
      />,
    );
    expect(screen.getByText("Volume <b>")).toBeDefined();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelectorAll("rect")).toHaveLength(4);
    expect(
      [...container.querySelectorAll("svg text")].map((text) => text.textContent),
    ).toStrictEqual(["0", "5,000", "10K", "15K", "Mon", "Tue"]);
    expect([...container.querySelectorAll("li")].map((item) => item.textContent)).toStrictEqual([
      "Buys",
      "Sales",
    ]);
    expect(container.querySelector(".sr-only")?.textContent).toBe(
      "Volume <b> (bar chart)\n- Buys: Mon: 3; Tue: 12000\n- Sales: Mon: 5; Tue: 1",
    );
  });

  it("draws lines, areas and pie slices", () => {
    const line = render(
      <ChartFigure
        chart={{
          chartType: "line",
          title: "Price",
          categories: ["a", "b"],
          series: [{ name: "BNB", values: [1, 2] }],
        }}
      />,
    );
    expect(line.container.querySelectorAll("polyline")).toHaveLength(1);
    cleanup();
    const area = render(
      <ChartFigure
        chart={{
          chartType: "area",
          title: "Value",
          categories: ["a", "b"],
          series: [{ name: "x", values: [1, 2] }],
        }}
      />,
    );
    expect(area.container.querySelectorAll("polygon")).toHaveLength(1);
    cleanup();
    const pie = render(
      <ChartFigure
        chart={{
          chartType: "pie",
          title: "Holdings",
          segments: [
            { label: "BNB", value: 3 },
            { label: "USDT", value: 1 },
          ],
        }}
      />,
    );
    expect(pie.container.querySelectorAll("path")).toHaveLength(2);
  });
});
