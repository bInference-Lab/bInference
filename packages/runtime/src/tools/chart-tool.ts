import { chartTextLines } from "@binference/chart";
import type { PortableChart } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** The args of `show_chart`: one flat object, as every provider's tool schemas accept. */
interface ChartToolArgs {
  readonly chartType: "pie" | "bar" | "area" | "line";
  readonly title: string;
  readonly segments?: readonly { readonly label: string; readonly value: number }[];
  readonly categories?: readonly string[];
  readonly series?: readonly { readonly name: string; readonly values: readonly number[] }[];
  readonly xLabel?: string;
  readonly yLabel?: string;
}

const chartArgs: z.ZodType<ChartToolArgs> = z.strictObject({
  chartType: z.enum(["pie", "bar", "area", "line"]),
  title: z.string(),
  segments: z.array(z.strictObject({ label: z.string(), value: z.number() })).exactOptional(),
  categories: z.array(z.string()).exactOptional(),
  series: z
    .array(z.strictObject({ name: z.string(), values: z.array(z.number()) }))
    .exactOptional(),
  xLabel: z.string().exactOptional(),
  yLabel: z.string().exactOptional(),
});

const refusals: Readonly<Record<string, string>> = {
  "protocol.bad_args":
    "The chart does not hold together: a pie needs 1 to 12 segments with values above zero; bars, areas and lines need 1 to 100 categories and 1 to 8 series, each with its own name and one value per category; a title is 1 to 80 characters and a label 1 to 40.",
};

function chartOf(args: ChartToolArgs): PortableChart {
  const { chartType, title } = args;
  if (chartType === "pie") {
    return { chartType, title, segments: args.segments ?? [] };
  }
  return {
    chartType,
    title,
    categories: args.categories ?? [],
    series: args.series ?? [],
    ...(args.xLabel === undefined ? {} : { xLabel: args.xLabel }),
    ...(args.yLabel === undefined ? {} : { yLabel: args.yLabel }),
  };
}

/**
 * `show_chart`, a control tool (decision 0387): shows the owner, in the chat of the turn, a pie of
 * segments or bars, areas or lines of series over categories. A surface that draws charts draws
 * it, any other shows it as text. The tool names what it showed, so the answer never repeats it.
 */
export function chartTool({ agent, client, turn }: AgentToolParts): AgentTool {
  return defineTool({
    name: "show_chart",
    kind: "control",
    description: agentToolTexts.show_chart,
    args: chartArgs,
    run: async (args, { signal }) =>
      answerOrRefusal({ tool: "show_chart", refusals }, async () => {
        const shown = await client.call(
          "turn/chart",
          { agent, turn: turn.turn, chart: chartOf(args) },
          { signal },
        );
        const lines = chartTextLines(shown.chart);
        const text = [
          "The owner now sees this chart in this chat, above your answer:",
          ...lines,
          "Do not repeat its numbers. Say only what the chart means for the owner, if anything.",
        ].join("\n");
        return { text, isError: false, shown: lines };
      }),
  });
}
