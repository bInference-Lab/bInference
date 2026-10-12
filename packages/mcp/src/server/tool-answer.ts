import { intentViewSchema, proposalAnswer } from "@binference/protocol";
import type { CallToolResult, TextContent } from "@modelcontextprotocol/server";
import type { ToolOperation } from "../tools/operation-tools.js";
import type { WireResult } from "./wire-result.schema.js";

function leadOf(operation: ToolOperation, wire: WireResult): string | undefined {
  if (operation !== "intent/propose") {
    return undefined;
  }
  const intent = intentViewSchema.safeParse(wire);
  return intent.success ? proposalAnswer(intent.data) : undefined;
}

/**
 * A tool's answer: the operation's result as JSON text, after a sentence for a proposal. The JSON
 * is the engine's own wire form, so the model reads amounts as decimal strings of base units.
 */
export function toolAnswer(operation: ToolOperation, wire: WireResult): CallToolResult {
  const lead = leadOf(operation, wire);
  const json: TextContent = { type: "text", text: JSON.stringify(wire) };
  return { content: lead === undefined ? [json] : [{ type: "text", text: lead }, json] };
}
