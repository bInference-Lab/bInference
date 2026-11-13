import { type Id, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { type AgentTool, defineTool } from "../tools/define-tool.js";
import type { ListedMcpClients } from "./listed-mcp-clients.js";
import type { ListedCallOutcome } from "./listed-mcp-entry.js";
import {
  type ListedMcpServer,
  type ListedMcpTool,
  listedToolName,
  type McpListing,
} from "./listing.schema.js";

/** What an agent's listed tools are made from: the listings in force and the connections. */
export interface ListedToolParts {
  readonly agent: Id<"agt">;
  /** The listings in force as the turn starts; only those on for the agent give it tools. */
  readonly servers: readonly ListedMcpServer[];
  readonly clients: ListedMcpClients;
}

type CallFailure = Extract<ListedCallOutcome, { readonly kind: "failed" }>;

const unread = (title: string): string =>
  `${title} gave an answer binference does not read; nothing of it was read.`;

// What the model reads when a call got no answer: binference's words, never the server's.
const failureTexts: Readonly<
  Record<CallFailure["reason"], (title: string, failure: CallFailure) => string>
> = {
  unreachable: (title) => `${title} did not answer. Answer without it, or try again later.`,
  timed_out: (title) => `${title} did not answer in time. Answer without it, or try again later.`,
  too_large: (title) => `${title} answered more than its listing allows; nothing of it was read.`,
  bad_answer: unread,
  refused: () =>
    "binference did not send this call: its arguments are too long or hold what looks like a secret, or the server sent binference elsewhere. Never send a secret to a listed server.",
  rate_limited: (title) => `${title} asked binference to wait before the next call.`,
  busy: (title) => `Four calls to ${title} already run; wait for their answers first.`,
  resting: (title, failure) =>
    `${title} failed several times in a row and rests for ${"seconds" in failure ? String(failure.seconds) : "some"} more seconds; answer without it for now.`,
  revoked: (title) => `${title} is no longer on for this agent.`,
  listing_changed: (title) =>
    `${title} was reviewed again while this turn ran; its tools as reviewed now come with the next turn.`,
  tool_off: (title, failure) =>
    "off" in failure && failure.off === "missing"
      ? `${title} no longer offers this tool; it is off until its listing is reviewed again.`
      : `This tool changed on ${title} since its review; it is off until its listing is reviewed again.`,
};

function outcomeText(title: string, outcome: ListedCallOutcome): ToolOutcome {
  if (outcome.kind === "answer") {
    return { text: outcome.text, isError: outcome.isError };
  }
  if (outcome.kind === "bad_answer") {
    return { text: unread(title), isError: true };
  }
  return { text: failureTexts[outcome.reason](title, outcome), isError: true };
}

// The arguments as the listing's input schema reads them, a field it does not name refused; a
// schema zod cannot read is no tool. A pipe would let a refused field through, stripped.
function argsOf(tool: ListedMcpTool): z.ZodType | undefined {
  try {
    return z.fromJSONSchema(tool.input);
  } catch {
    return undefined;
  }
}

function toolOf(
  parts: ListedToolParts,
  listing: McpListing,
  tool: ListedMcpTool,
): AgentTool | undefined {
  const args = argsOf(tool);
  if (args === undefined) {
    return undefined;
  }
  const call = {
    agent: parts.agent,
    listing: listing.listing,
    version: listing.version,
    tool: tool.as,
  };
  try {
    return defineTool({
      name: listedToolName(listing, tool),
      kind: "read",
      parallel: true,
      outside: true,
      description: `From the listed MCP server ${listing.title}: ${tool.description}`,
      args,
      run: async (input, { signal }) => {
        const json = jsonValueSchema.safeParse(input);
        const outcome = json.success
          ? await parts.clients.call({ ...call, args: json.data }, signal)
          : ({ kind: "failed", reason: "refused" } as const);
        return outcomeText(listing.title, outcome);
      },
    });
  } catch {
    // A schema the tool rules refuse gives the agent no tool; the listing schema already took it.
    return undefined;
  }
}

/**
 * The tools of the listed MCP servers an agent has on (decision 0428): each a `read` that may run
 * beside other reads, named `mcp-<name>-<as>`, its description the listing's led by the server's
 * title, its arguments checked with the listing's input schema, and every result outside
 * content. Each reaches its server only through the agent's connections; none reaches the engine.
 */
export function listedMcpTools(parts: ListedToolParts): readonly AgentTool[] {
  return parts.servers
    .filter((server) => server.agents.includes(parts.agent))
    .flatMap(({ listing }) => listing.tools.flatMap((tool) => toolOf(parts, listing, tool) ?? []));
}

/** Whether an agent has a listed server on, whose tools' words reach each of its turns. */
export function offersListedTools(servers: readonly ListedMcpServer[], agent: Id<"agt">): boolean {
  return servers.some((server) => server.agents.includes(agent) && server.listing.tools.length > 0);
}
