import type { PortableChart } from "@binference/protocol";

/** A size to lay a chart out in, in the units the surface draws with. */
export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

/** A category's label at its place along the axis. */
export interface AxisMark {
  readonly at: number;
  readonly label: string;
}

/** A value tick at its place along the axis; the surface formats the value. */
export interface ValueMark {
  readonly at: number;
  readonly value: number;
}

/** One shape of a chart: a bar, a line, an area or a pie slice, with its series' index. */
export type ChartMark =
  | {
      readonly kind: "bar";
      readonly series: number;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: "line";
      readonly series: number;
      readonly points: readonly (readonly [number, number])[];
    }
  | {
      readonly kind: "area";
      readonly series: number;
      readonly points: readonly (readonly [number, number])[];
      readonly base: number;
    }
  | { readonly kind: "slice"; readonly series: number; readonly path: string };

/** A chart laid out: its plot area, its axes' marks, its shapes and its legend. */
export interface ChartLayout {
  readonly plot: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly yMarks: readonly ValueMark[];
  readonly xMarks: readonly AxisMark[];
  readonly marks: readonly ChartMark[];
  readonly legend: readonly string[];
}

const margin = { left: 48, top: 12, right: 12, bottom: 28 };
// A step for about four ticks: 1, 2 or 5 times a power of ten.
function niceStep(range: number): number {
  const rough = range / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const steps = [1, 2, 5, 10].map((each) => each * power);
  return steps.find((step) => step >= rough) ?? 10 * power;
}

// The value range the axis shows: from zero for bars and areas, padded to whole steps.
function rangeOf(
  values: readonly number[],
  options: { readonly fromZero: boolean },
): { readonly low: number; readonly high: number; readonly step: number } {
  const low = Math.min(...values, ...(options.fromZero ? [0] : []));
  const high = Math.max(...values, ...(options.fromZero ? [0] : []));
  const span = high === low ? Math.abs(high) || 1 : high - low;
  const step = niceStep(span);
  const top = Math.ceil(high / step) * step;
  const bottom = Math.floor(low / step) * step;
  return { low: bottom, high: top === bottom ? bottom + step : top, step };
}

type SeriesChart = Exclude<PortableChart, { readonly chartType: "pie" }>;

function seriesLayout(chart: SeriesChart, size: ChartSize): ChartLayout {
  const plot = {
    left: margin.left,
    top: margin.top,
    right: size.width - margin.right,
    bottom: size.height - margin.bottom,
  };
  const all = chart.series.flatMap((each) => each.values);
  const { low, high, step } = rangeOf(all, { fromZero: chart.chartType !== "line" });
  const yOf = (value: number): number =>
    plot.bottom - ((value - low) / (high - low)) * (plot.bottom - plot.top);
  const band = (plot.right - plot.left) / chart.categories.length;
  const center = (index: number): number => plot.left + band * (index + 0.5);
  // Each tick from its count of steps, so no sum of steps drifts.
  const ticks = Math.round((high - low) / step);
  const yMarks = Array.from({ length: ticks + 1 }, (_tick, index): ValueMark => {
    const value = low + index * step;
    return { at: yOf(value), value };
  });
  const every = Math.max(1, Math.ceil(chart.categories.length / 8));
  const xMarks = chart.categories
    .map((label, index): AxisMark => ({ at: center(index), label }))
    .filter((_mark, index) => index % every === 0);
  const zero = yOf(Math.max(low, Math.min(0, high)));
  const marks: ChartMark[] = chart.series.flatMap((each, series): ChartMark[] => {
    const points = each.values.map((value, index): readonly [number, number] => [
      center(index),
      yOf(value),
    ]);
    if (chart.chartType === "line") {
      return [{ kind: "line", series, points }];
    }
    if (chart.chartType === "area") {
      return [{ kind: "area", series, points, base: zero }];
    }
    const width = (band * 0.8) / chart.series.length;
    return each.values.map((value, index) => {
      const top = Math.min(yOf(value), zero);
      return {
        kind: "bar",
        series,
        x: center(index) - band * 0.4 + width * series,
        y: top,
        width,
        height: Math.abs(zero - yOf(value)),
      };
    });
  });
  return { plot, yMarks, xMarks, marks, legend: chart.series.map((each) => each.name) };
}

// A coordinate kept to two decimals, enough for a drawing.
const round = (value: number): number => Math.round(value * 100) / 100;
const point = (x: number, y: number): string => `${String(round(x))} ${String(round(y))}`;

function pieLayout(
  chart: Extract<PortableChart, { readonly chartType: "pie" }>,
  size: ChartSize,
): ChartLayout {
  const plot = { left: 0, top: 0, right: size.width, bottom: size.height };
  const radius = Math.min(size.width, size.height) / 2 - 8;
  const cx = size.width / 2;
  const cy = size.height / 2;
  const total = chart.segments.reduce((sum, segment) => sum + segment.value, 0);
  let angle = -Math.PI / 2;
  const marks = chart.segments.map((segment, series): ChartMark => {
    const sweep = (segment.value / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const from = point(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    const to = point(cx + radius * Math.cos(end - 1e-6), cy + radius * Math.sin(end - 1e-6));
    angle = end;
    return {
      kind: "slice",
      series,
      path: `M ${point(cx, cy)} L ${from} A ${String(radius)} ${String(radius)} 0 ${String(large)} 1 ${to} Z`,
    };
  });
  return {
    plot,
    yMarks: [],
    xMarks: [],
    marks,
    legend: chart.segments.map((segment) => segment.label),
  };
}

/**
 * Lays a chart out in a size (decision 0387): bars, lines or areas over a plot with about four
 * value ticks, from zero for bars and areas, and at most eight category labels; or pie slices as
 * SVG paths around the middle. A surface draws the shapes in its own colors, one per series.
 */
export function chartLayout(chart: PortableChart, size: ChartSize): ChartLayout {
  return chart.chartType === "pie" ? pieLayout(chart, size) : seriesLayout(chart, size);
}
