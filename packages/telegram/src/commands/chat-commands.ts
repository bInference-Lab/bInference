import { idSchema } from "@binference/core";
import type { AgentView } from "@binference/protocol";
import { chooseAgent } from "./agent-commands.js";
import { callOrSay, type CommandContext } from "./command-context.js";

// The agents `/agents` and `/use` know: every one not archived, at most this many.
const agentPage = { limit: 200 } as const;

async function activeAgents(context: CommandContext): Promise<readonly AgentView[] | undefined> {
  const listed = await callOrSay(context, "agent/list", agentPage);
  return listed?.items.filter((agent) => agent.archivedAt === undefined);
}

function namesOf(agents: readonly AgentView[]): string {
  return agents.map((agent) => agent.name).join(", ");
}

/**
 * `/agents`: each agent that is not archived with its mode and freeze, the one this chat talks
 * to marked, and how `/use` picks another (decision 0204).
 */
export async function runAgents(context: CommandContext): Promise<void> {
  const agents = await activeAgents(context);
  if (agents === undefined) {
    return;
  }
  if (agents.length === 0) {
    await context.say(context.words("cmd.agent.none"));
    return;
  }
  const picked = await context.pickedAgent();
  const talking =
    agents.find((agent) => agent.agent === picked) ?? (agents.length === 1 ? agents[0] : undefined);
  const { words, formatter } = context;
  const lines = agents.map((agent) =>
    words("cmd.agents.item", {
      name: agent.name,
      mode: words("cmd.mode", { mode: agent.mode }),
      frozen: agent.frozenAt === undefined ? "no" : "yes",
      when: agent.frozenAt === undefined ? "" : formatter.dateTime(agent.frozenAt),
      chat: agent === talking ? "yes" : "no",
    }),
  );
  await context.say(
    [words("cmd.agents.heading"), ...lines, words("cmd.agents.useHint")].join("\n"),
  );
}

/**
 * `/use <name or id>`: picks the agent this chat talks to, kept with the paired owner so it
 * outlasts a restart (decision 0204). A name matches in any letter case.
 */
export async function runUse(context: CommandContext): Promise<void> {
  const agents = await activeAgents(context);
  if (agents === undefined) {
    return;
  }
  const asked = context.args.toLowerCase();
  const found = agents.find(
    (agent) => agent.agent === context.args || agent.name.toLowerCase() === asked,
  );
  if (found === undefined) {
    const key = context.args === "" ? "cmd.use.how" : "cmd.use.unknown";
    const first = agents[0]?.name ?? "";
    await context.say(context.words(key, { name: context.args, agents: namesOf(agents), first }));
    return;
  }
  await context.useAgent(idSchema("agt").parse(found.agent));
  await context.say(context.words("cmd.use.done", { name: found.name }));
}

/**
 * `/clear`: starts a new chat session with the agent through `chat/clear`; the running turn ends
 * and an open question closes. The agent's notes and workspace stay.
 */
export async function runClear(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const cleared = await callOrSay(context, "chat/clear", { agent: agent.id });
  if (cleared !== undefined) {
    await context.say(context.words("cmd.clear.done"));
  }
}

/**
 * `/schedules`: the agent's active schedules with their next run, read with `schedule/list`. While
 * the engine serves no schedules, the reply says none is set yet (decision 0204).
 */
export async function runSchedules(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const { calls, senderId, signal, words, formatter } = context;
  const listed = await calls.call(
    { op: "schedule/list", args: { agent: agent.id }, senderId },
    { signal },
  );
  if (!listed.ok && listed.error !== "protocol.unknown_op") {
    await context.say(words(`error.${listed.error}`));
    return;
  }
  const active = listed.ok ? listed.value.items.filter((item) => item.state === "active") : [];
  if (active.length === 0) {
    await context.say(words("cmd.schedules.none"));
    return;
  }
  const lines = active.map((item) =>
    words("cmd.schedules.item", {
      prompt: item.prompt,
      next: item.nextAt === undefined ? "" : formatter.dateTime(item.nextAt),
    }),
  );
  await context.say([words("cmd.schedules.heading"), ...lines].join("\n"));
}
