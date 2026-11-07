import type { PortableChart } from "@binference/protocol";

/**
 * A chart as text, for a surface that draws no chart (decision 0387): its title and kind, then a
 * line per slice of a pie, or the axes' names and a line per series with each category's value.
 */
export function chartTextLines(chart: PortableChart): readonly string[] {
  const head = `${chart.title} (${chart.chartType} chart)`;
  if (chart.chartType === "pie") {
    return [
      head,
      ...chart.segments.map((segment) => `- ${segment.label}: ${String(segment.value)}`),
    ];
  }
  const axes = [
    ...(chart.xLabel === undefined ? [] : [`X axis: ${chart.xLabel}`]),
    ...(chart.yLabel === undefined ? [] : [`Y axis: ${chart.yLabel}`]),
  ];
  const series = chart.series.map(
    (each) =>
      `- ${each.name}: ${chart.categories
        .map((category, index) => `${category}: ${String(each.values[index] ?? 0)}`)
        .join("; ")}`,
  );
  return [head, ...axes, ...series];
}
