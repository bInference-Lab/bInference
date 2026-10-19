import { type ArgsOf, marketTermFields, type ScanFilter } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { isoTimeSchema } from "./iso-time.schema.js";
import { chartAnswer, scanAnswer } from "./market-answers.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

// The agent's market reads (runtime spec, section 5.1): each maps onto one read operation, and
// every result with data in it marks the turn (decision 0257). The page sizes keep the largest
// page of each inside the 12,000 characters a result may hold (decision 0258).

const fields = marketTermFields;

const sourceDown =
  "the market data source is down or limits how often binference calls it. Try again in about a minute; until then answer without it.";

/** The tokens `market_scan` answers unless the model asks for others, and the most it may. */
export const scanItems = { usual: 10, most: 20 } as const;

/** What `market_scan` takes: the chain, where its tokens come from, the filters, how many. */
interface ScanArgs {
  readonly chain: ArgsOf<"market/scan">["chain"];
  readonly source: ArgsOf<"market/scan">["source"];
  readonly filters?: ScanFilter;
  readonly limit?: number;
}

const scanArgs: z.ZodType<ScanArgs> = z
  .strictObject({
    chain: fields.chain,
    source: z.enum(["launches", "trending"]),
    filters: fields.scanFilter.exactOptional(),
    limit: z.int().min(1).max(scanItems.most).exactOptional(),
  })
  .refine((args) => args.source === "launches" || args.filters === undefined, {
    message: "filters describe launches: leave them out with source trending",
    path: ["filters"],
  });

const scanRefusals: Readonly<Record<string, string>> = {
  "protocol.bad_args":
    "market_scan failed with protocol.bad_args: the engine refused the terms. The chain is not one binference holds, a launchpad in filters.launchpads runs no launch feed here, or a token in filters.quoteTokens is not on binference's token list. Scan without launchpads to see the launchpad of each launch, and find a quote token's id with token_search.",
  "market.no_launch_feed":
    "market_scan failed with market.no_launch_feed: binference reads no launches now, since no launchpad's launch feed runs on this install. Scan trending tokens instead, or tell the owner.",
  "market.no_data":
    "market_scan failed with market.no_data: the market data source lists no trending token on this chain now.",
  "market.source_down": `market_scan failed with market.source_down: ${sourceDown}`,
};

function marketScanTool({ client }: AgentToolParts): AgentTool {
  return defineTool<ScanArgs>({
    name: "market_scan",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.market_scan,
    args: scanArgs,
    run: async (args, { signal }) =>
      answerOrRefusal({ tool: "market_scan", refusals: scanRefusals }, async () => {
        const scan = { ...args, limit: args.limit ?? scanItems.usual };
        return scanAnswer(args.source, await client.call("market/scan", scan, { signal }));
      }),
  });
}

/** The candles `chart` answers unless the model asks for others, and the most it may. */
export const chartCandles = { usual: 60, most: 100 } as const;

/** What `chart` takes: the token, the candle width, the time the candles end by, how many. */
interface ChartArgs {
  readonly asset: ArgsOf<"market/chart">["asset"];
  readonly interval: ArgsOf<"market/chart">["interval"];
  readonly to?: number;
  readonly limit?: number;
}

const chartArgs: z.ZodType<ChartArgs> = z.strictObject({
  asset: fields.asset,
  interval: fields.interval,
  to: isoTimeSchema.exactOptional(),
  limit: z.int().min(1).max(chartCandles.most).exactOptional(),
});

const chartRefusals: Readonly<Record<string, string>> = {
  "protocol.bad_args":
    "chart failed with protocol.bad_args: the engine refused the terms, a token on a chain binference does not hold.",
  "market.no_data":
    "chart failed with market.no_data: no market data source has candles for this token. A token still on a launchpad's curve has none until it moves to a pool; read it with token_info or quote instead.",
  "market.source_down": `chart failed with market.source_down: ${sourceDown}`,
};

function chartTool({ client }: AgentToolParts): AgentTool {
  return defineTool<ChartArgs>({
    name: "chart",
    kind: "read",
    parallel: true,
    addressSource: "engine",
    description: agentToolTexts.chart,
    args: chartArgs,
    run: async (args, { signal }) =>
      answerOrRefusal({ tool: "chart", refusals: chartRefusals }, async () => {
        const chart = { ...args, limit: args.limit ?? chartCandles.usual };
        return chartAnswer(await client.call("market/chart", chart, { signal }));
      }),
  });
}

/**
 * The agent's market reads (decisions 0257 and 0258): `market_scan` over `market/scan` and
 * `chart` over `market/chart`, the agent filled from the turn. Each answers compact lines; one
 * that holds data marks the turn as outside content, and an engine refusal reads as what to do
 * next.
 */
export function marketTools(parts: AgentToolParts): readonly AgentTool[] {
  return [marketScanTool(parts), chartTool(parts)];
}
