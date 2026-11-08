import type { Clock, Id } from "@binference/core";
import { dayStartOf } from "@binference/i18n";
import { z } from "zod";
import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import { isConfiguredModel } from "../providers/model-ref.js";
import {
  type ChatStanding,
  type StatusFacts,
  type StatusHelpers,
  type StatusSpend,
  statusText,
} from "./agent-status-answer.js";
import { agentStatusHelperText, agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import type { AgentToolParts } from "./tool-client.js";

/** The session a turn serves, as the status reads it, and the chat model it may set. */
export interface ChatStatusSource {
  /** The session's start, turns and chat model; `undefined` when the store does not hold it. */
  read(session: Id<"ses">, signal: AbortSignal): Promise<ChatStanding | undefined>;
  /**
   * Sets the session's chat model, or clears it with none; `false` when the session is no longer
   * open. Absent in a helper's turn, which never sets a model (decision 0404).
   */
  readonly setModel?: (
    change: { readonly session: Id<"ses">; readonly model?: string },
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** What the engine last answered of the agent's model budget, for when `usage/get` fails. */
  budgetLeft(agent: Id<"agt">): bigint | undefined;
}

/** What `agent_status` reads beyond the engine: the session, the settings, the version, the time. */
export interface AgentStatusParts {
  readonly chats: ChatStatusSource;
  readonly settings: Pick<RuntimeSettings, "models" | "owner">;
  /** binference's release. */
  readonly version: string;
  readonly clock: Clock;
}

/** What the agent's own `agent_status` takes: a chat model to set, or `default` to clear it. */
interface StatusArgs {
  readonly model?: string;
}

const setterArgs: z.ZodType<StatusArgs> = z.strictObject({
  model: z.string().trim().min(3).max(200).exactOptional(),
});

// A helper's turn reads the status and names no model.
const readerArgs: z.ZodType<StatusArgs> = z.strictObject({});

/** Today's model spend and budget from `usage/get`, or what the engine last answered. */
async function spendOf(
  parts: AgentToolParts,
  status: AgentStatusParts,
  signal: AbortSignal,
): Promise<StatusSpend> {
  const nowMs = status.clock.now();
  const from = dayStartOf(nowMs, status.settings.owner.timezone);
  const { agent } = parts;
  try {
    const usage = await parts.client.call("usage/get", { agent, from, to: nowMs + 1 }, { signal });
    const budget = usage.budgets.find((each) => each.agent === agent);
    if (budget !== undefined) {
      const rows = usage.rows.filter((row) => row.agent === agent);
      const spentMicros = rows.reduce((sum, row) => sum + row.usdMicros, 0n);
      const { dailyUsdMicros: dailyMicros, leftUsdMicros: leftMicros } = budget;
      return { read: true, spentMicros, dailyMicros, leftMicros };
    }
  } catch {
    signal.throwIfAborted();
  }
  const lastLeftMicros = status.chats.budgetLeft(agent);
  return lastLeftMicros === undefined ? { read: false } : { read: false, lastLeftMicros };
}

// A read the engine or the store does not answer is missing from the answer, not a failed call.
async function orMissing<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}

async function helpersOf(parts: AgentToolParts, signal: AbortSignal): Promise<StatusHelpers> {
  const { helpers } = parts;
  if (helpers === undefined) {
    return "helper_turn";
  }
  return (await orMissing(async () => helpers.desk.list(parts.agent, signal), signal)) ?? "unread";
}

/** Every fact of the answer, read at once; each read that fails is left out. */
async function factsOf(
  parts: AgentToolParts,
  status: AgentStatusParts,
  context: { readonly signal: AbortSignal; readonly turn: StatusFacts["turn"] },
): Promise<StatusFacts> {
  const { agent, client } = parts;
  const { signal } = context;
  const [view, facts, spend, chat, helpers] = await Promise.all([
    orMissing(async () => client.call("agent/get", { agent }, { signal }), signal),
    orMissing(async () => client.call("facts/get", { agent }, { signal }), signal),
    spendOf(parts, status, signal),
    orMissing(async () => status.chats.read(parts.turn.session, signal), signal),
    helpersOf(parts, signal),
  ]);
  const { models, owner } = status.settings;
  const providers = Object.keys(models.providers);
  const stored = chat?.model;
  const chatModel =
    stored !== undefined && isConfiguredModel(stored, providers) ? stored : undefined;
  return {
    ...(view === undefined ? {} : { agent: view }),
    ...(facts === undefined ? {} : { facts }),
    spend,
    ...(chat === undefined ? {} : { chat }),
    turn: context.turn,
    helpers,
    models,
    ...(chatModel === undefined ? {} : { chatModel }),
    version: status.version,
    nowMs: status.clock.now(),
    timeZone: owner.timezone,
  };
}

/** Why a chat model was not set, with the next step, or the line that says it was. */
async function changeModel(
  parts: AgentToolParts,
  status: AgentStatusParts,
  context: { readonly model: string; readonly signal: AbortSignal },
): Promise<{ readonly head: string; readonly isError: boolean }> {
  const { setModel } = status.chats;
  const clears = context.model === "default";
  const providers = Object.keys(status.settings.models.providers);
  if (setModel === undefined) {
    return { head: "not set: a helper never sets a model.", isError: true };
  }
  if (!clears && !isConfiguredModel(context.model, providers)) {
    return {
      head: `not set: model must be <provider>/<model> of a provider the settings configure (${providers.join(", ")}), or default.`,
      isError: true,
    };
  }
  const change = clears
    ? { session: parts.turn.session }
    : { session: parts.turn.session, model: context.model };
  if (!(await setModel(change, context.signal))) {
    return {
      head: "not set: this chat was cleared; the next chat runs on the configured model.",
      isError: true,
    };
  }
  return clears
    ? { head: "This chat runs on the configured model again from its next turn.", isError: false }
    : {
        head: `This chat talks with ${context.model} from its next turn until it is cleared; the daily model budget still caps its spend, and default puts the configured model back.`,
        isError: false,
      };
}

/**
 * `agent_status` (decision 0404): a read of the agent's own state in one answer, never outside
 * content. In the agent's own turns, whose chats can set a model, it takes `model` and declares
 * that no helper calls it; in a helper's turn it takes no arguments, so a helper reads it and
 * never sets a model.
 */
export function agentStatusTool(parts: AgentToolParts, status: AgentStatusParts): AgentTool {
  const sets = status.chats.setModel !== undefined;
  return defineTool<StatusArgs>({
    name: "agent_status",
    kind: "read",
    forHelpers: !sets,
    description: sets ? agentToolTexts.agent_status : agentStatusHelperText,
    args: sets ? setterArgs : readerArgs,
    run: async (args, { signal, turnState }) => {
      const change =
        args.model === undefined
          ? undefined
          : await changeModel(parts, status, { model: args.model, signal });
      const facts = await factsOf(parts, status, { signal, turn: turnState() });
      return { text: statusText(facts, change?.head), isError: change?.isError ?? false };
    },
  });
}
