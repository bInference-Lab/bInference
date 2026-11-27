import type { AgentToolName } from "@binference/runtime";

/** What an MCP client calls in place of one of the agent's tools: a tool and the args it fixes. */
interface McpCall {
  readonly tool: `binference_${string}`;
  readonly args?: string;
}

const propose = (args: string): McpCall => ({ tool: "binference_propose", args });

/**
 * The MCP tool for each of the agent's tools (decision 0457), or `none` for a tool the MCP server
 * does not serve. Every agent tool has a row, so a new one gets its answer here when it is added.
 */
const mcpCallOf: Readonly<Record<AgentToolName, McpCall | "none">> = {
  token_search: { tool: "binference_token_search" },
  addresses: { tool: "binference_addresses" },
  wallets: { tool: "binference_wallets" },
  portfolio: { tool: "binference_portfolio" },
  token_info: { tool: "binference_token_info" },
  token_risk: { tool: "binference_token_risk" },
  quote: { tool: "binference_quote" },
  orders: { tool: "binference_orders" },
  tx_status: { tool: "binference_intent_status" },
  intents: { tool: "binference_intents" },
  market_scan: "none",
  chart: "none",
  wallet_activity: "none",
  swap: propose('kind: "swap"'),
  buy: propose('kind: "buy"'),
  sell: propose('kind: "sell"'),
  send: propose('kind: "send"'),
  approval_revoke: propose('kind: "revokeApproval"'),
  order_create: { tool: "binference_order_create" },
  stake: propose('kind: "stake", action: "stake"'),
  unstake: propose('kind: "stake", action: "unstake"'),
  claim: propose('kind: "stake", action: "claim"'),
  bridge: propose('kind: "bridge"'),
  bridge_quote: { tool: "binference_bridge_quote" },
  staking_options: { tool: "binference_staking_options" },
  order_cancel: { tool: "binference_order_cancel" },
  alert_create: { tool: "binference_alert_create" },
  schedule_list: "none",
  schedule_create: "none",
  schedule_cancel: "none",
  search_web: "none",
  read_page: "none",
  search_x: "none",
  notes_search: "none",
  notes_get: "none",
  notes_write: "none",
  notes_forget: "none",
  open_skill: "none",
  workspace_write: "none",
  first_chat_end: "none",
  launchpads: "none",
  launch_draft: "none",
  ask_owner: "none",
  shell: "none",
  shell_job: "none",
  browse: "none",
  deposit_address: "none",
  look_at_image: "none",
  look_at_screen: "none",
  read_pdf: "none",
  file_read: "none",
  file_write: "none",
  file_edit: "none",
  file_patch: "none",
  show_chart: "none",
  make_image: "none",
  make_video: "none",
  speak: "none",
  show_images: "none",
  send_files: "none",
  credentials: "none",
  http_request: "none",
  settings_read: "none",
  settings_change: "none",
  helper_start: "none",
  helper_list: "none",
  helper_read: "none",
  helper_send: "none",
  helper_stop: "none",
  agent_status: "none",
  goal_set: "none",
  goal_read: "none",
  goal_update: "none",
  progress_note: "none",
  skill_proposal: "none",
};

const toolNames = new Set<string>(Object.keys(mcpCallOf));

function isAgentTool(word: string): word is AgentToolName {
  return toolNames.has(word);
}

// A code span that is a tool's name, or a word of the text joined by underscores that is one. A
// one-word name in plain text, such as "quote", is an English word, not the tool.
const codeSpan = /`([^`\n]+)`/g;
const joinedWord = /\b[a-z]+(?:_[a-z]+)+\b/g;

/**
 * The agent's tools a text names, each once, in the order it first names them: in a code span
 * that is the tool's name, or as a word joined by underscores. A skill's copy for MCP clients
 * names none of them.
 */
export function agentToolsNamed(text: string): readonly AgentToolName[] {
  const spans = [...text.matchAll(codeSpan)].map((match) => match[1] ?? "");
  const words = [...text.matchAll(joinedWord)].map((match) => match[0]);
  return [...new Set([...spans, ...words].filter((word) => isAgentTool(word)))];
}

function wordsOf(call: McpCall): string {
  return call.args === undefined ? `\`${call.tool}\`` : `\`${call.tool}\` with \`${call.args}\``;
}

function callOf(word: string): McpCall | undefined {
  const call = isAgentTool(word) ? mcpCallOf[word] : undefined;
  return call === "none" ? undefined : call;
}

// Each tool the text names, in a code span or as a joined word, written as its MCP call.
function withMcpCalls(text: string): string {
  const spans = text.replaceAll(codeSpan, (span, word: string) => {
    const call = callOf(word);
    return call === undefined ? span : wordsOf(call);
  });
  return spans.replaceAll(joinedWord, (word) => {
    const call = callOf(word);
    return call === undefined ? word : call.tool;
  });
}

function namesServedToolsOnly(text: string): boolean {
  return agentToolsNamed(text).every((tool) => mcpCallOf[tool] !== "none");
}

const unitStart = /^(?:#{1,6} |\s*(?:[-*]|\d+\.) |\|)/;
const heading = /^(#{1,6}) /;

// The body's blocks: a heading, a list item with its lines, a table row, a paragraph, or a blank
// line, so a block that names a tool the MCP server lacks can be left out whole.
function blocksOf(body: string): string[] {
  const blocks: string[] = [];
  for (const line of body.split("\n")) {
    const last = blocks.at(-1);
    const joins =
      last !== undefined &&
      last !== "" &&
      line !== "" &&
      !heading.test(last) &&
      !unitStart.test(line);
    if (joins) {
      blocks[blocks.length - 1] = `${last}\n${line}`;
    } else {
      blocks.push(line);
    }
  }
  return blocks;
}

function levelOf(block: string): number {
  return heading.exec(block)?.[1]?.length ?? 0;
}

// Leaves out a heading whose section holds nothing once the blocks that named an absent tool went.
function withoutEmptySections(blocks: readonly string[]): string[] {
  return blocks.filter((block, at) => {
    const level = levelOf(block);
    if (level === 0) {
      return true;
    }
    const rest = blocks.slice(at + 1);
    const end = rest.findIndex((next) => levelOf(next) !== 0 && levelOf(next) <= level);
    return (end === -1 ? rest : rest.slice(0, end)).some((next) => next.trim() !== "");
  });
}

// What the copy says after its title: where the agent id every MCP tool takes comes from.
const mcpCopyNote =
  "This copy is for MCP clients of binference. Each `binference_*` tool names the agent it acts " +
  "for: take its id from `binference_agents`, as the `binference-tools` skill says.";

function withNote(blocks: readonly string[]): string[] {
  const title = blocks.findIndex((block) => levelOf(block) === 1);
  return title === -1
    ? [mcpCopyNote, "", ...blocks]
    : [...blocks.slice(0, title + 1), "", mcpCopyNote, ...blocks.slice(title + 1)];
}

/** Why a skill has no copy for MCP clients. */
export type McpCopyRefusal =
  | { readonly reason: "no_frontmatter" | "not_for_agent" }
  | { readonly reason: "agent_only"; readonly tools: readonly AgentToolName[] };

/** A skill's copy for MCP clients, or why it has none. */
export type McpCopyOutcome =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: McpCopyRefusal };

function refused(error: McpCopyRefusal): McpCopyOutcome {
  return { ok: false, error };
}

const frontmatter = /^---\n([\s\S]*?)\n---\n/;
const agentAudience = /^(\s+binference-audience:) agent$/m;

/**
 * The copy of one of the agent's skills for MCP clients (decision 0457), made from its
 * `SKILL.md`: its audience `mcp`, each tool of the agent named as the MCP tool that does the same
 * (`buy` as `binference_propose` with `kind: "buy"`), each block of the body that names a tool the
 * MCP server lacks left out, then a heading left with nothing, and a note on agent ids after the
 * title. A skill whose frontmatter names such a tool is the agent's alone: `agent_only`, with
 * the tools. A copy that would still name a tool of the agent is refused the same way.
 */
export function mcpSkillCopy(text: string): McpCopyOutcome {
  const found = frontmatter.exec(text);
  if (found === null) {
    return refused({ reason: "no_frontmatter" });
  }
  const [whole, front = ""] = found;
  if (!agentAudience.test(front)) {
    return refused({ reason: "not_for_agent" });
  }
  if (!namesServedToolsOnly(front)) {
    return refused({ reason: "agent_only", tools: agentToolsNamed(front) });
  }
  const kept = blocksOf(text.slice(whole.length)).filter((block) => namesServedToolsOnly(block));
  const body = withNote(withoutEmptySections(kept.map((block) => withMcpCalls(block))))
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n");
  const copy = `---\n${withMcpCalls(front).replace(agentAudience, "$1 mcp")}\n---\n${body}`;
  const left = agentToolsNamed(copy);
  return left.length === 0
    ? { ok: true, value: copy }
    : refused({ reason: "agent_only", tools: left });
}
