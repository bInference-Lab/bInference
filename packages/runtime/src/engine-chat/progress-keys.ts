import type { AgentToolName } from "../tools/agent-tool-texts.js";

/** One progress line as `turn/progress` sends it: its key in spec 4 and the values it takes. */
export interface ProgressKey {
  readonly key: string;
  readonly values?: Readonly<Record<string, string>>;
}

// The line each of the agent's tools shows while it runs; a tool with nothing of its own to show,
// a question to the owner or the first chat's end, shows none.
const toolKeys: Readonly<Record<AgentToolName, string | undefined>> = {
  token_search: "turn.tool.tokenSearch",
  addresses: "turn.tool.addresses",
  wallets: "turn.tool.wallets",
  portfolio: "turn.tool.portfolio",
  token_info: "turn.tool.tokenInfo",
  token_risk: "turn.tool.tokenRisk",
  quote: "turn.tool.quote",
  orders: "turn.tool.orders",
  tx_status: "turn.tool.txStatus",
  market_scan: "turn.tool.marketScan",
  chart: "turn.tool.chart",
  wallet_activity: "turn.tool.walletActivity",
  swap: "turn.tool.swap",
  buy: "turn.tool.buy",
  sell: "turn.tool.sell",
  send: "turn.tool.send",
  approval_revoke: "turn.tool.approvalRevoke",
  order_create: "turn.tool.orderCreate",
  stake: "turn.tool.stake",
  unstake: "turn.tool.unstake",
  claim: "turn.tool.claim",
  bridge: "turn.tool.bridge",
  bridge_quote: "turn.tool.bridgeQuote",
  staking_options: "turn.tool.stakingOptions",
  order_cancel: "turn.tool.orderCancel",
  alert_create: "turn.tool.alertCreate",
  schedule_list: "turn.tool.scheduleList",
  schedule_create: "turn.tool.scheduleCreate",
  schedule_cancel: "turn.tool.scheduleCancel",
  search_web: "turn.tool.searchWeb",
  read_page: "turn.tool.readPage",
  search_x: "turn.tool.searchX",
  notes_search: "turn.tool.notesSearch",
  notes_get: "turn.tool.notesGet",
  notes_write: "turn.tool.notesWrite",
  notes_forget: "turn.tool.notesForget",
  open_skill: "turn.tool.openSkill",
  workspace_write: "turn.tool.workspaceWrite",
  first_chat_end: undefined,
  launchpads: "turn.tool.launchpads",
  launch_draft: "turn.tool.launchDraft",
  ask_owner: undefined,
  deposit_address: "turn.tool.deposit",
  shell: "turn.tool.shell",
  shell_job: "turn.tool.shellJob",
  browse: "turn.tool.browse",
  look_at_image: "turn.tool.lookAtImage",
  read_pdf: "turn.tool.readPdf",
  file_read: "turn.tool.fileRead",
  file_write: "turn.tool.fileWrite",
  file_edit: "turn.tool.fileEdit",
  file_patch: "turn.tool.filePatch",
  show_chart: "turn.tool.showChart",
  make_image: "turn.tool.makeImage",
  show_images: "turn.tool.showImages",
  send_files: "turn.tool.sendFiles",
  credentials: "turn.tool.credentials",
  settings_read: "turn.tool.settingsRead",
  settings_change: "turn.tool.settingsChange",
};

// A plugin's tool is named `<id>__<tool>`, its id with `_` for `-`.
const pluginTool = /^([a-z0-9_]{1,64})__[A-Za-z0-9_]+$/u;

function isAgentTool(name: string): name is AgentToolName {
  return Object.hasOwn(toolKeys, name);
}

/**
 * The progress line of spec 4, section 8.1, that a tool's run shows: one per agent tool, the
 * plugin's line for a plugin's tool, and none for a tool that shows nothing or a name no tool
 * has.
 */
export function progressKeyOf(tool: string): ProgressKey | undefined {
  if (isAgentTool(tool)) {
    const key = toolKeys[tool];
    return key === undefined ? undefined : { key };
  }
  const plugin = pluginTool.exec(tool)?.[1];
  return plugin === undefined ? undefined : { key: "turn.tool.plugin", values: { plugin } };
}
