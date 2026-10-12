import { bpsSchema } from "@binference/core";
import { limitLines } from "@binference/i18n";
import type { LimitChanges, LimitsView, ResultOf } from "@binference/protocol";
import type { ButtonRows } from "../ingress/bot-calls.js";
import {
  commandCallbackData,
  type HalvableLimit,
  halvableLimits,
} from "./command-callback.schema.js";
import {
  type CallContext,
  callOrSay,
  type CommandContext,
  type PressContext,
} from "./command-context.js";

type AgentStatus = ResultOf<"engine/status">["agents"][number];

/**
 * The agent a command or a chat message is for: the only agent that is not archived. With none,
 * or several, it says why, and that the CLI names one with `--agent`, and answers `undefined`.
 */
export async function chooseAgent(context: CallContext): Promise<AgentStatus | undefined> {
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

const halves: { readonly [L in HalvableLimit]: (limits: LimitsView) => LimitChanges } = {
  perTradeUsdMicros: (limits) => ({ perTradeUsdMicros: limits.perTradeUsdMicros / 2n }),
  rollingDayUsdMicros: (limits) => ({ rollingDayUsdMicros: limits.rollingDayUsdMicros / 2n }),
  slippageRegistryBps: (limits) => ({
    slippageRegistryBps: bpsSchema.parse(Math.floor(limits.slippageRegistryBps / 2)),
  }),
  slippageOtherBps: (limits) => ({
    slippageOtherBps: bpsSchema.parse(Math.floor(limits.slippageOtherBps / 2)),
  }),
};

// A limit already at zero has no half below it, so it has no button.
function isAboveZero(limits: LimitsView, limit: HalvableLimit): boolean {
  return limits[limit] > 0;
}

function buttonsOf(context: CommandContext, limits: LimitsView): ButtonRows {
  return halvableLimits
    .filter((limit) => isAboveZero(limits, limit))
    .map((limit) => [
      {
        text: context.words("cmd.limits.halve", { limit }),
        data: commandCallbackData({ kind: "halve", limit }),
      },
    ]);
}

function limitsReply(context: CommandContext, limits: LimitsView): string {
  const { pending } = limits;
  const waiting =
    pending === undefined
      ? []
      : [
          context.words("cmd.limits.pendingHeading", {
            when: context.formatter.dateTime(pending.effectiveAt),
          }),
          ...limitsText(context, pending.changes),
        ];
  const heading = context.words("cmd.limits.heading", { agent: limits.agent });
  const lines = [heading, ...limitsText(context, limits), ...waiting];
  return [...lines, context.words("cmd.limits.tapToHalve")].join("\n");
}

/**
 * `/limits`: the agent's limits in effect, the looser ones that wait with their time, and a
 * button for each cap and slippage limit above zero that halves it.
 */
export async function runLimits(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const view = await callOrSay(context, "limit/get", { agent: agent.id });
  if (view !== undefined) {
    await context.say(limitsReply(context, view), { buttons: buttonsOf(context, view) });
  }
}

// What a limit reads now: its name and its value, as `/limits` shows it.
function limitText(context: CommandContext, limits: LimitsView, limit: HalvableLimit) {
  const display = { formatter: context.formatter, chains: context.chains };
  const [line] = limitLines({ [limit]: limits[limit] }, display);
  return { name: line?.name ?? limit, value: line?.value ?? "" };
}

/**
 * A press of a `/limits` button: halves that limit of the only agent through `limit/set`, which
 * applies a stricter limit at once and announces it (decision 0111), then shows the limits again
 * with their buttons, so another press halves it again. A limit at zero stays as it is.
 */
export async function runHalve(context: PressContext, limit: HalvableLimit): Promise<void> {
  const agent = await chooseAgent(context);
  const before =
    agent === undefined ? undefined : await callOrSay(context, "limit/get", { agent: agent.id });
  if (agent === undefined || before === undefined || !isAboveZero(before, limit)) {
    const lowest = before === undefined ? undefined : limitText(context, before, limit);
    await context.answer(lowest && context.words("cmd.limits.lowest", lowest));
    return;
  }
  const changes = halves[limit](before);
  const after = await callOrSay(context, "limit/set", { agent: agent.id, changes });
  if (after === undefined) {
    await context.answer();
    return;
  }
  await context.edit(limitsReply(context, after), buttonsOf(context, after));
  await context.answer(context.words("cmd.limits.halved", limitText(context, after, limit)));
}
