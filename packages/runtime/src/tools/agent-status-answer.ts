import { createFormatter, type Formatter, nextDayStartOf } from "@binference/i18n";
import type { AgentView, LiveFactsView } from "@binference/protocol";
import type { HelperRecord } from "@binference/store";
import type { RuntimeModels } from "../control/runtime-settings.schema.js";
import type { TurnState } from "../loop/turn-records.js";

// What `agent_status` answers (decision 0404). A model reads it, never the owner, so it stays
// English; every fact in it is binference's own.

/** Today's model spend and budget, from `usage/get`, or only what is left, as last answered. */
export type StatusSpend =
  | {
      readonly read: true;
      readonly spentMicros: bigint;
      readonly dailyMicros: bigint;
      readonly leftMicros: bigint;
    }
  | { readonly read: false; readonly lastLeftMicros?: bigint };

/** The session the turn serves, as `agent.sqlite` keeps it. */
export interface ChatStanding {
  readonly startedAtMs: number;
  readonly turns: number;
  /** The chat model the agent set, as stored, whether or not the settings still configure it. */
  readonly model?: string;
}

/** The agent's helpers, or none to show in a helper's own turn. */
export type StatusHelpers = readonly HelperRecord[] | "unread" | "helper_turn";

/** Every fact the answer names, each `undefined` when it could not be read now. */
export interface StatusFacts {
  readonly agent?: Pick<AgentView, "agent" | "name">;
  readonly facts?: Pick<LiveFactsView, "mode" | "frozen" | "approvalMode">;
  readonly spend: StatusSpend;
  readonly chat?: ChatStanding;
  readonly turn: TurnState;
  readonly helpers: StatusHelpers;
  readonly models: Pick<
    RuntimeModels,
    "main" | "fast" | "vision" | "imageMaking" | "videoMaking" | "speech"
  >;
  /** The chat model the next turn runs on: the stored one while its provider is configured. */
  readonly chatModel?: string;
  readonly version: string;
  readonly nowMs: number;
  readonly timeZone: string;
}

const unread = "could not be read now";

function agentLine({ agent, facts }: StatusFacts): string {
  const who =
    agent === undefined ? `Agent: name ${unread}.` : `Agent: ${agent.name} (${agent.agent}).`;
  if (facts === undefined) {
    return `${who} Mode, freeze and approval mode ${unread}.`;
  }
  const frozen = facts.frozen ? "frozen" : "not frozen";
  return `${who} Mode ${facts.mode}, ${frozen}, approval mode ${facts.approvalMode}.`;
}

function named(model: string | undefined): string {
  return model ?? "none set";
}

function modelsLine({ models, chat, chatModel }: StatusFacts): string {
  const own = chatModel === undefined ? "" : ` This chat talks with its own model, ${chatModel}.`;
  const ignored =
    chat?.model !== undefined && chatModel === undefined
      ? ` This chat's model ${chat.model} is ignored: its provider is no longer in models.providers.`
      : "";
  return `Models in force: main ${named(models.main)}, fast ${named(models.fast)}, vision ${named(models.vision)}, image making ${named(models.imageMaking)}, video making ${named(models.videoMaking)}, speech ${named(models.speech)}.${own}${ignored}`;
}

function spendLine(status: StatusFacts, formatter: Formatter): string {
  const resets = formatter.dateTime(nextDayStartOf(status.nowMs, status.timeZone));
  const { spend } = status;
  if (spend.read) {
    const { spentMicros, dailyMicros, leftMicros } = spend;
    return `Model spend today: ${formatter.usd(spentMicros)} of the ${formatter.usd(dailyMicros)} daily budget, ${formatter.usd(leftMicros)} left; it resets at ${resets}.`;
  }
  const left =
    spend.lastLeftMicros === undefined
      ? ""
      : ` ${formatter.usd(spend.lastLeftMicros)} was left when binference last answered.`;
  return `Model spend today ${unread}.${left} The budget resets at ${resets}.`;
}

function contextText({ context }: TurnState): string {
  if (context === undefined) {
    return "";
  }
  const share = Math.round((context.usedTokens * 100) / Math.max(1, context.windowTokens));
  const used = String(Math.round(context.usedTokens / 1000));
  const window = String(Math.round(context.windowTokens / 1000));
  return ` The context holds about ${used}k of ${window}k tokens (${String(share)}%).`;
}

function chatLine(status: StatusFacts, formatter: Formatter): string {
  const { chat, turn } = status;
  const standing =
    chat === undefined
      ? `This chat: its start and turns ${unread}.`
      : `This chat: started ${formatter.dateTime(chat.startedAtMs)}, ${String(chat.turns)} turns so far, this one among them.`;
  const outside = turn.outside
    ? "This turn holds outside content, so its proposals carry a warning."
    : "This turn holds no outside content.";
  return `${standing} This turn calls ${turn.model}.${contextText(turn)} ${outside}`;
}

function helpersLine({ helpers }: StatusFacts): string {
  if (helpers === "helper_turn") {
    return "Helpers: none shown; this turn is a helper's.";
  }
  if (helpers === "unread") {
    return `Helpers: ${unread}.`;
  }
  const running = helpers.filter(({ state }) => state === "running");
  const labels = running.map(({ id, label }) => `"${label}" (${id})`);
  const now =
    running.length === 0
      ? "none running"
      : `${String(running.length)} running: ${labels.join(", ")}`;
  const ended = helpers.length - running.length;
  const earlier = ended === 0 ? "" : `; ${String(ended)} more ended, which helper_list lists`;
  return `Helpers: ${now}${earlier}.`;
}

/**
 * What `agent_status` answers: the agent, the models in force, today's model spend against the
 * budget and when it resets, this chat and turn, the helpers, binference's version and the time,
 * each in the owner's timezone and each said to be missing when it could not be read. `head`, a
 * line about a chat model the call set or cleared, goes first.
 */
export function statusText(status: StatusFacts, head?: string): string {
  const formatter = createFormatter({ locale: "en", timeZone: status.timeZone });
  const lines = [
    agentLine(status),
    modelsLine(status),
    spendLine(status, formatter),
    chatLine(status, formatter),
    helpersLine(status),
    `binference ${status.version}. Now ${formatter.dateTime(status.nowMs)} (${status.timeZone}).`,
  ];
  return (head === undefined ? lines : [head, ...lines]).join("\n");
}
