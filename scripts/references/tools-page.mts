import type { Formatter } from "@binference/i18n";
import { operationTools } from "@binference/mcp";
import { describeAgentTools, type ToolReference } from "@binference/runtime";
import { code, type ReferencePage, table } from "./reference-page.mjs";
import { toolSummaryKey } from "./required-messages.mjs";

function agentToolLine(tool: ToolReference, formatter: Formatter): string {
  const kind = formatter.message(`docs.tools.kind.${tool.kind}`);
  return `- ${code(tool.name)} (${kind}): ${formatter.message(toolSummaryKey(tool.name))}`;
}

function mcpTable(formatter: Formatter): string {
  const headers = ["tool", "does", "operation", "requestId"].map((key) =>
    formatter.message(`docs.tools.${key}`),
  );
  const rows = operationTools().map((tool) => [
    code(tool.name),
    formatter.message(toolSummaryKey(tool.name)),
    code(tool.operation),
    formatter.message(tool.takesRequestId ? "docs.yes" : "docs.no"),
  ]);
  return table(headers, rows);
}

// Each tool shows its summary for the owner. The text a model reads stays English (section 14),
// so the pages leave it out.
function render(formatter: Formatter): string {
  return [
    `## ${formatter.message("docs.tools.agent")}`,
    "",
    formatter.message("docs.tools.agentIntro"),
    "",
    ...describeAgentTools().map((tool) => agentToolLine(tool, formatter)),
    "",
    `## ${formatter.message("docs.tools.mcp")}`,
    "",
    formatter.message("docs.tools.mcpIntro"),
    "",
    mcpTable(formatter),
    "",
  ].join("\n");
}

/** The reference of the agent's tools and the MCP server's, from their declarations. */
export const toolsPage: ReferencePage = { name: "tools", file: "agent-and-mcp-tools", render };
