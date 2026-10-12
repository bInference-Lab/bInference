import type { ToolBox } from "../loop/ports.js";
import { createToolBox } from "./create-tool-box.js";
import type { AgentTool } from "./define-tool.js";
import { orderCancelTool } from "./order-cancel-tool.js";
import { readTools } from "./read-tools.js";
import type { AgentToolParts } from "./tool-client.js";
import { tradeTools } from "./trade-tools.js";

/**
 * The agent's tools for one agent (runtime spec, section 5.1): the reads `portfolio`,
 * `token_info`, `token_risk`, `quote`, `orders` and `tx_status`; the proposals `swap`, `buy`,
 * `sell` and `order_create`; and `order_cancel`, which brakes. Each maps onto one operation of
 * the engine and names the given agent; no tool takes an agent or a wallet from the model.
 */
export function agentTools(parts: AgentToolParts): readonly AgentTool[] {
  return [...readTools(parts), ...tradeTools(parts), orderCancelTool(parts)];
}

/** A tool box holding {@link agentTools} for one agent's turn. */
export function agentToolBox(parts: AgentToolParts): ToolBox {
  return createToolBox(agentTools(parts));
}
