import { z } from "zod";

/** One slice of a pie chart: its label and a value above zero. */
interface ChartSegment {
  readonly label: string;
  readonly value: number;
}

/** One series of a bar, area or line chart: its name and one value per category, in order. */
interface ChartSeries {
  readonly name: string;
  readonly values: readonly number[];
}

/**
 * A chart the agent shows the owner as data (decision 0387): a pie of segments, or bars, areas or
 * lines of series over shared categories. A surface that draws charts draws it; any other shows
 * its text.
 */
export type PortableChart =
  | {
      readonly chartType: "pie";
      readonly title: string;
      readonly segments: readonly ChartSegment[];
    }
  | {
      readonly chartType: "bar" | "area" | "line";
      readonly title: string;
      readonly categories: readonly string[];
      readonly series: readonly ChartSeries[];
      readonly xLabel?: string;
      readonly yLabel?: string;
    };

/** The limits of a chart: its title and labels, and how many slices, categories and series. */
const chartLimits: {
  readonly titleChars: number;
  readonly labelChars: number;
  readonly segments: number;
  readonly categories: number;
  readonly series: number;
} = { titleChars: 80, labelChars: 40, segments: 12, categories: 100, series: 8 };

const title = z.string().trim().min(1).max(chartLimits.titleChars);
const label = z.string().trim().min(1).max(chartLimits.labelChars);
// A zod number is finite: it refuses infinity and NaN.
const finite = z.number();

const pieSchema = z.strictObject({
  chartType: z.literal("pie"),
  title,
  segments: z
    .array(z.strictObject({ label, value: finite.refine((value) => value > 0, "above zero") }))
    .min(1)
    .max(chartLimits.segments)
    .readonly(),
});

const seriesChartSchema = z
  .strictObject({
    chartType: z.enum(["bar", "area", "line"]),
    title,
    categories: z.array(label).min(1).max(chartLimits.categories).readonly(),
    series: z
      .array(z.strictObject({ name: label, values: z.array(finite).readonly() }))
      .min(1)
      .max(chartLimits.series)
      .readonly(),
    xLabel: label.exactOptional(),
    yLabel: label.exactOptional(),
  })
  .refine(
    (chart) => chart.series.every((each) => each.values.length === chart.categories.length),
    "every series holds one value per category",
  )
  .refine(
    (chart) => new Set(chart.series.map((each) => each.name)).size === chart.series.length,
    "every series has its own name",
  );

/** Parses a {@link PortableChart}. */
export const portableChartSchema: z.ZodType<PortableChart> = z.union([
  pieSchema,
  seriesChartSchema,
]);
