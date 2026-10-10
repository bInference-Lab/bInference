import { limitLines } from "@binference/engine/surfaces";
import type { LimitChanges, ResultOf } from "@binference/protocol";
import { callOrSay, type CommandContext } from "./command-context.js";

type AgentStatus = ResultOf<"engine/status">["agents"][number];

/**
 * The agent a command acts on: the only agent that is not archived. With none, or several, it
 * says why, and that the CLI names one with `--agent`, and answers `undefined`.
 */
async function chooseAgent(context: CommandContext): Promise<AgentStatus | undefined> {
  const status = await callOrSay(context, "engine/status", {});
  if (status === undefined) {
    return undefined;
  }
  const { agents } = status;
  const [only] = agents;
  if (only !== undefined && agents.length === 1) {
    return only;
  }
  const ids = agents.map((agent) => agent.id).join(", ");
  await context.say(
    only === undefined
      ? context.words("cmd.agent.none")
      : context.words("cmd.agent.several", { count: agents.length, agents: ids }),
  );
  return undefined;
}

/** `/paper`: switches the agent to paper mode, a brake that needs no card (spec 4, section 5). */
export async function runPaper(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const view = await callOrSay(context, "agent/goPaper", { agent: agent.id });
  if (view !== undefined) {
    const key = agent.mode === "paper" ? "cmd.paper.already" : "cmd.paper.done";
    await context.say(context.words(key, { name: view.name }));
  }
}

function limitsText(context: CommandContext, changes: LimitChanges): readonly string[] {
  const display = { formatter: context.formatter, chains: context.chains };
  return limitLines(changes, display).map(({ name, value }) =>
    context.words("cmd.limits.item", { name, value }),
  );
}

/** `/limits`: the agent's limits in effect, and the looser ones that wait with their time. */
export async function runLimits(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const view = await callOrSay(context, "limit/get", { agent: agent.id });
  if (view === undefined) {
    return;
  }
  const { pending } = view;
  const waiting =
    pending === undefined
      ? []
      : [
          context.words("cmd.limits.pendingHeading", {
            when: context.formatter.dateTime(pending.effectiveAt),
          }),
          ...limitsText(context, pending.changes),
        ];
  const heading = context.words("cmd.limits.heading", { agent: agent.id });
  await context.say([heading, ...limitsText(context, view), ...waiting].join("\n"));
}
