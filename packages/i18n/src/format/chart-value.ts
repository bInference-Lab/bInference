const exact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/**
 * Formats a chart's value, as an axis shows it (decision 0387): up to 4 decimals, and from 10,000
 * up in the compact form, `12.5K`. A chart's values are the agent's numbers, never money the
 * engine counts, so they are plain numbers.
 */
export function formatChartValue(value: number): string {
  return Math.abs(value) >= 10_000 ? compact.format(value) : exact.format(value);
}
