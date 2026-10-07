import { type IntentState, type IntentView, intentViewSchema } from "@binference/protocol";
import type { CallToolResult, TextContent } from "@modelcontextprotocol/server";
import type { ToolOperation } from "../tools/operation-tools.js";
import type { WireResult } from "./wire-result.schema.js";

// The states before the owner's tap: the engine still checks the intent, or its card is open.
const waitingStates: ReadonlySet<IntentState> = new Set<IntentState>([
  "proposed",
  "checked",
  "quoted",
  "assessed",
  "simulated",
  "awaiting_confirmation",
]);

/**
 * The sentence a proposal answers with: the intent's id and, while it waits for the owner's tap,
 * that it waits for the owner's confirmation in Telegram or the console. Any other intent, such as
 * one the engine refused by policy or risk, names its state and its reason.
 */
function proposalText(intent: IntentView): string {
  if (waitingStates.has(intent.state)) {
    return `Intent ${intent.intent} is waiting for the owner's confirmation in Telegram or the console.`;
  }
  const reason = intent.outcome?.reason;
  const why = reason === undefined ? "" : ` with reason ${reason}`;
  return `Intent ${intent.intent} is in state ${intent.state}${why}.`;
}

function leadOf(operation: ToolOperation, wire: WireResult): string | undefined {
  if (operation !== "intent/propose") {
    return undefined;
  }
  const intent = intentViewSchema.safeParse(wire);
  return intent.success ? proposalText(intent.data) : undefined;
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
