import { listedMcpTools } from "../listed-mcp/listed-mcp-tools.js";
import type { ToolBox } from "../loop/ports.js";
import { agentStatusTool } from "./agent-status-tool.js";
import { alertCreateTool } from "./alert-create-tool.js";
import { askOwnerTool } from "./ask-owner-tool.js";
import { browseTool } from "./browse-tool.js";
import { chartTool } from "./chart-tool.js";
import { createToolBox } from "./create-tool-box.js";
import { credentialsTool } from "./credentials-tool.js";
import type { AgentTool } from "./define-tool.js";
import { depositTool } from "./deposit-tool.js";
import { fileTools } from "./file-tools.js";
import { goalTools } from "./goal-tools.js";
import { helperTools } from "./helper-tools.js";
import { httpRequestTool } from "./http-request-tool.js";
import { launchDraftTool } from "./launch-draft-tool.js";
import { launchpadsTool } from "./launchpads-tool.js";
import { lookAtImageTool } from "./look-at-image-tool.js";
import { lookAtScreenTool } from "./look-at-screen-tool.js";
import { makeImageTool } from "./make-image-tool.js";
import { makeVideoTool } from "./make-video-tool.js";
import { marketTools } from "./market-tools.js";
import { noteTools } from "./note-tools.js";
import { orderCancelTool } from "./order-cancel-tool.js";
import { pluginTools } from "./plugin-tools.js";
import { readPdfHiddenArgs, readPdfTool } from "./read-pdf-tool.js";
import { readTools } from "./read-tools.js";
import { scheduleTools } from "./schedule-tools.js";
import { sendFilesTool } from "./send-files-tool.js";
import { settingsChangeTool, settingsReadTool } from "./settings-tools.js";
import { shellTools } from "./shell-tools.js";
import { showImagesTool } from "./show-images-tool.js";
import { skillProposalTool } from "./skill-proposal-tool.js";
import { openSkillTool } from "./skill-tools.js";
import { speakTool } from "./speak-tool.js";
import type { AgentToolParts } from "./tool-client.js";
import { tradeTools } from "./trade-tools.js";
import { webTools } from "./web-tools.js";
import { workspaceTools } from "./workspace-tools.js";

/** The arguments of each tool, by its name, that the transcript keeps hidden. */
export const hiddenToolArgs: ReadonlyMap<string, readonly string[]> = new Map([
  ["read_pdf", readPdfHiddenArgs],
]);

/**
 * The agent's tools for one agent (runtime spec, section 5.1): the reads `addresses`, `wallets`,
 * `portfolio`, `token_info`, `token_risk`, `quote`, `bridge_quote`, `staking_options`, `orders`, `tx_status`,
 * `intents`,
 * the market reads `market_scan`,
 * `chart` and `wallet_activity` (decision 0257), and `schedule_list`; the proposals
 * `swap`, `buy`, `sell`, `send`, `approval_revoke`, `order_create`, `stake`, `unstake`, `claim`
 * and `bridge`;
 * `order_cancel`, which brakes; and the control tools `alert_create`, `schedule_create` and `schedule_cancel` (decision 0247). Each
 * maps onto the engine's operations and names the given agent; no tool takes an agent or a wallet
 * from the model. With web parts, the web tools come after the reads; `look_at_image` (decision 0385), `look_at_screen` (decision 0406) and `read_pdf` (decision 0402) follow, then the tools of the
 * enabled community plugins (decision 0349) and of the listed MCP servers the agent has on (decision 0428); `notes_search`, `notes_get`, `settings_read`, with
 * status parts `agent_status` (decision 0404), and `open_skill` follow them, then `notes_write` and `notes_forget` (decision 0384), and last `workspace_write` and `first_chat_end`, which write
 * the owner's strategy and persona and end the first chat (decision 0242), then `launchpads` and
 * `launch_draft`, which drafts a token launch the owner starts (decision 0285),
 * then `deposit_address`, which shows the owner where to send funds (decision 0380), `show_chart`,
 * which shows the owner a chart (decision 0387), with image parts `make_image`, which makes images
 * in the background (decision 0392), with video parts `make_video` and with speech parts `speak`
 * (decision 0405), with helper parts the helper tools (decision 0403), with goal parts the goal
 * tools `goal_set`, `goal_read`, `goal_update` and `progress_note` (decision 0407),
 * `skill_proposal`, which proposes skills the owner applies (decision 0408), the machine
 * tools `shell` and `shell_job` (decision 0378), `browse` (decision 0401) and the file tools (decision 0386), `http_request`, an API call with the owner's stored credentials (decision 0411), `credentials`, which asks the owner for a credential and ends
 * the turn (decision 0388), then `ask_owner`, which asks the
 * owner in the turn the tools serve and ends it after its batch.
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
    lookAtImageTool(parts),
    lookAtScreenTool(parts),
    readPdfTool(parts),
    ...pluginTools(parts, parts.plugins ?? []),
    ...(parts.listedMcp === undefined
      ? []
      : listedMcpTools({ ...parts.listedMcp, agent: parts.agent })),
    notes.search,
    notes.get,
    settingsReadTool(parts),
    ...(parts.status === undefined ? [] : [agentStatusTool(parts, parts.status)]),
    openSkillTool(parts),
    ...tradeTools(parts),
    settingsChangeTool(parts),
    orderCancelTool(parts),
    alertCreateTool(parts),
    schedules.create,
    schedules.cancel,
    notes.write,
    notes.forget,
    ...workspaceTools(parts),
    launchpadsTool(parts),
    launchDraftTool(parts),
    depositTool(parts),
    showImagesTool(parts),
    sendFilesTool(parts),
    chartTool(parts),
    ...(parts.imageMaking === undefined ? [] : [makeImageTool(parts, parts.imageMaking)]),
    ...(parts.videoMaking === undefined ? [] : [makeVideoTool(parts, parts.videoMaking)]),
    ...(parts.speaking === undefined ? [] : [speakTool(parts, parts.speaking)]),
    ...(parts.helpers === undefined ? [] : helperTools(parts, parts.helpers)),
    ...(parts.goals === undefined ? [] : goalTools(parts, parts.goals)),
    skillProposalTool(parts),
    ...shellTools(parts),
    browseTool(parts),
    ...fileTools(parts),
    httpRequestTool(parts),
    credentialsTool(parts),
    askOwnerTool(parts),
  ];
}

/** A tool box holding {@link agentTools} for one agent's turn. */
export function agentToolBox(parts: AgentToolParts): ToolBox {
  return createToolBox(agentTools(parts));
}

/**
 * The tool box of a helper's turn (decision 0403): only the agent's tools a helper may call, the
 * reads and machine tools that do not say otherwise, so a helper never proposes, never acts in the
 * owner's chat and never starts a helper.
 */
export function helperToolBox(parts: AgentToolParts): ToolBox {
  return createToolBox(agentTools(parts).filter((tool) => tool.forHelpers));
}
