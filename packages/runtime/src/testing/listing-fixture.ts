import type { Id, JsonSchemaNode } from "@binference/core";
import type { ListedMcpServer, ListedMcpTool, McpListing } from "../listed-mcp/listing.schema.js";
import { type ServerToolDefinition, serverDigestOf } from "../listed-mcp/server-digest.js";
import { nthTestId } from "./memory-agent-stores.js";

/** The fixture server's own definition of `get_rate`, as a review read it from `tools/list`. */
export const fixtureServerTool: ServerToolDefinition = {
  name: "get_rate",
  inputSchema: {
    type: "object",
    properties: { symbol: { type: "string" } },
    required: ["symbol"],
  },
  outputSchema: {
    type: "object",
    properties: { rate: { type: "number" } },
    required: ["rate"],
  },
};

const rateInput: JsonSchemaNode = {
  type: "object",
  properties: { symbol: { type: "string", maxLength: 12 } },
  required: ["symbol"],
  additionalProperties: false,
};

const rateOutput: JsonSchemaNode = {
  type: "object",
  properties: { rate: { type: "number" } },
  required: ["rate"],
  additionalProperties: false,
};

/** The fixture listing's one tool, `get_rate` as `rate`, pinned to {@link fixtureServerTool}. */
export const fixtureListedTool: ListedMcpTool = {
  server: "get_rate",
  as: "rate",
  kind: "read",
  description: "The exchange rate of a token symbol against USD.",
  input: rateInput,
  output: rateOutput,
  serverDigest: serverDigestOf(fixtureServerTool),
};

/** A listing the listing schema takes, with what a test changes in it. */
export function listingFixture(changes: Partial<McpListing> = {}): McpListing {
  return {
    listing: nthTestId("mls", 1),
    version: 1,
    name: "ratesdemo",
    title: "Rates Demo",
    url: "https://rates.example.com/mcp",
    revision: "2025-11-25",
    timeoutMs: 15_000,
    maxBytes: 262_144,
    tools: [fixtureListedTool],
    ...changes,
  };
}

/** The fixture listing in force for `agents`, with what a test changes in the listing. */
export function listedServerFixture(
  agents: readonly Id<"agt">[],
  changes: Partial<McpListing> = {},
): ListedMcpServer {
  return { listing: listingFixture(changes), agents };
}

// A tool of the fixture's shape whose schemas each carry a description of `chars` characters.
function largeTool(index: number, chars: number): ListedMcpTool {
  return {
    ...fixtureListedTool,
    server: `get_rate_${String(index)}`,
    as: `rate${String(index)}`,
    description: "d".repeat(1_000),
    input: { ...rateInput, description: "i".repeat(chars) },
    output: { ...rateOutput, description: "o".repeat(chars) },
  };
}

/**
 * The `n`th of a run of large listings in force for `agents`: `tools` tools whose input and output
 * schemas each carry a description of `chars` characters, as a test of the byte budgets needs.
 */
export function largeListedServer(
  agents: readonly Id<"agt">[],
  n: number,
  size: { readonly tools: number; readonly chars: number },
): ListedMcpServer {
  const tools = Array.from({ length: size.tools }, (_, index) => largeTool(index, size.chars));
  return listedServerFixture(agents, {
    name: `big${String(n)}`,
    listing: nthTestId("mls", n),
    tools,
  });
}
