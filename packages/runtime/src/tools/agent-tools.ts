import type { ToolBox } from "../loop/ports.js";
import { alertCreateTool } from "./alert-create-tool.js";
import { askOwnerTool } from "./ask-owner-tool.js";
import { createToolBox } from "./create-tool-box.js";
import type { AgentTool } from "./define-tool.js";
import { marketTools } from "./market-tools.js";
import { noteTools } from "./note-tools.js";
import { orderCancelTool } from "./order-cancel-tool.js";
import { readTools } from "./read-tools.js";
import { scheduleTools } from "./schedule-tools.js";
import { openSkillTool } from "./skill-tools.js";
import type { AgentToolParts } from "./tool-client.js";
import { tradeTools } from "./trade-tools.js";
import { webTools } from "./web-tools.js";
import { workspaceTools } from "./workspace-tools.js";

/**
 * The agent's tools for one agent (runtime spec, section 5.1): the reads `portfolio`,
 * `token_info`, `token_risk`, `quote`, `orders`, `tx_status`, the market reads `market_scan`,
 * `chart` and `wallet_activity` (decision 0257), and `schedule_list`; the proposals
 * `swap`, `buy`, `sell` and `order_create`; `order_cancel`, which brakes; and the control tools
 * `alert_create`, `schedule_create` and `schedule_cancel` (decision 0247). Each maps onto the
 * engine's operations and names the given agent; no tool takes an agent or a wallet from the
 * model. With web parts, the web tools come after the reads; `notes_search` and `open_skill`
 * follow them, then `notes_write`, and last `workspace_write` and `first_chat_end`, which write
 * the owner's strategy and persona and end the first chat (decision 0242), then `ask_owner`,
 * which asks the owner in the turn the tools serve and ends it after its batch.
 */
export function agentTools(parts: AgentToolParts): readonly AgentTool[] {
  const web = parts.web === undefined ? [] : webTools(parts.web);
  const notes = noteTools(parts);
  const schedules = scheduleTools(parts);
  return [
    ...readTools(parts),
    ...marketTools(parts),
    schedules.list,
    ...web,
    notes.search,
    openSkillTool(parts),
    ...tradeTools(parts),
    orderCancelTool(parts),
    alertCreateTool(parts),
    schedules.create,
    schedules.cancel,
    notes.write,
    ...workspaceTools(parts),
    askOwnerTool(parts),
  ];
}

/** A tool box holding {@link agentTools} for one agent's turn. */
export function agentToolBox(parts: AgentToolParts): ToolBox {
  return createToolBox(agentTools(parts));
}
