import { type ChartLayout, type ChartMark, chartLayout, chartTextLines } from "@binference/chart";
import { displayOutsideText } from "@binference/i18n";
import type { PortableChart } from "@binference/protocol";
import { useFormatter } from "../i18n/console-text";

const size = { width: 480, height: 240 } as const;
const seriesColors = 6;

// A series' color from the theme, the same in the drawing and its legend.
function colorOf(series: number): string {
  return `var(--chart-${String((series % seriesColors) + 1)})`;
}

const shown = (text: string): string => displayOutsideText(text, Number.POSITIVE_INFINITY);

function pointsOf(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${String(x)},${String(y)}`).join(" ");
}

function AreaShape(props: {
  readonly mark: Extract<ChartMark, { readonly kind: "area" }>;
}): React.JSX.Element {
  const { mark } = props;
  const color = colorOf(mark.series);
  const first = mark.points[0]?.[0] ?? 0;
  const last = mark.points.at(-1)?.[0] ?? 0;
  const base = String(mark.base);
  const outline = `${String(first)},${base} ${pointsOf(mark.points)} ${String(last)},${base}`;
  return (
    <g>
      <polygon points={outline} fill={color} fillOpacity={0.2} />
      <polyline points={pointsOf(mark.points)} fill="none" stroke={color} strokeWidth={2} />
    </g>
  );
}

function MarkShape(props: { readonly mark: ChartMark }): React.JSX.Element {
  const { mark } = props;
  const color = colorOf(mark.series);
  if (mark.kind === "bar") {
    const { x, y, width, height } = mark;
    return <rect x={x} y={y} width={width} height={height} fill={color} rx={2} />;
  }
  if (mark.kind === "line") {
    return <polyline points={pointsOf(mark.points)} fill="none" stroke={color} strokeWidth={2} />;
  }
  if (mark.kind === "area") {
    return <AreaShape mark={mark} />;
  }
  return <path d={mark.path} fill={color} stroke="var(--background)" strokeWidth={1} />;
}

function Axes(props: { readonly layout: ChartLayout }): React.JSX.Element {
  const formatter = useFormatter();
  const { plot, yMarks, xMarks } = props.layout;
  return (
    <g fontSize={11} fill="currentColor">
      {yMarks.map((mark) => (
        <g key={`y ${String(mark.value)}`}>
          <line x1={plot.left} x2={plot.right} y1={mark.at} y2={mark.at} stroke="var(--border)" />
          <text x={plot.left - 6} y={mark.at + 4} textAnchor="end">
            {formatter.chartValue(mark.value)}
          </text>
        </g>
      ))}
      {xMarks.map((mark) => (
        <text key={`x ${mark.label}`} x={mark.at} y={plot.bottom + 18} textAnchor="middle">
          {shown(mark.label)}
        </text>
      ))}
    </g>
  );
}

function Legend(props: { readonly names: readonly string[] }): React.JSX.Element {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {props.names.map((name, series) => (
        <li key={name} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-sm"
            style={{ background: colorOf(series) }}
          />
          {shown(name)}
        </li>
      ))}
    </ul>
  );
}

/**
 * A chart the agent showed (decision 0387), drawn as SVG in the theme's series colors, with its
 * title, value ticks, category labels and legend. Its words are the agent's, shown as text; a
 * screen reader reads the chart's text form in place of the drawing.
 */
export function ChartFigure(props: { readonly chart: PortableChart }): React.JSX.Element {
  const { chart } = props;
  const layout = chartLayout(chart, size);
  return (
    <figure className="mr-auto w-full max-w-[85%] rounded-lg border px-3 py-2 text-sm">
      <figcaption className="font-medium">{shown(chart.title)}</figcaption>
      <p className="sr-only whitespace-pre-line">{chartTextLines(chart).map(shown).join("\n")}</p>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
        className="mt-2 h-auto w-full text-muted-foreground"
      >
        <Axes layout={layout} />
        {layout.marks.map((mark, index) => (
          <MarkShape key={`${mark.kind} ${String(index)}`} mark={mark} />
        ))}
      </svg>
      <Legend names={layout.legend} />
    </figure>
  );
}
