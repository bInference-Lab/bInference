import {
  type ReasoningShown,
  reasoningShownSchema,
  type ReplyStream,
  replyStreamSchema,
} from "@binference/engine/surfaces";
import type { MessageLocale } from "@binference/i18n";
import { z } from "zod";
import { type SkillChoice, skillCallbackData, skillChoiceOf } from "./skill-callback.js";

/**
 * The limits a `/limits` button halves: the caps and the slippage limits, each stricter at half
 * its value (decision 0111), so a tap applies at once and never loosens anything.
 */
export const halvableLimits = [
  "perTradeUsdMicros",
  "rollingDayUsdMicros",
  "slippageRegistryBps",
  "slippageOtherBps",
] as const;

/** A limit a `/limits` button halves. */
export type HalvableLimit = (typeof halvableLimits)[number];

/**
 * What a fast command's button asks for (spec 4, section 2): halve a limit of `/limits`, or set
 * the owner's language from `/lang`, pick a model from `/ai`, set how replies show from
 * `/replies`, or apply, reject or accept a skill from `/skills` (decision 0408).
 */
export type CommandCallback =
  | { readonly kind: "halve"; readonly limit: HalvableLimit }
  | { readonly kind: "language"; readonly locale: MessageLocale }
  | { readonly kind: "model"; readonly digest: string }
  | { readonly kind: "replies"; readonly choice: ReplyChoice }
  | { readonly kind: "skill"; readonly choice: SkillChoice };

/** A `/replies` button's one setting: how replies grow, or how reasoning shows (decision 0377). */
export type ReplyChoice = { readonly stream: ReplyStream } | { readonly reasoning: ReasoningShown };

const halvePattern = /^bnf1:t:h:(\w{1,32})$/;
const languagePattern = /^bnf1:l:s:(en|zh)$/;
const modelPattern = /^bnf1:m:s:([\w-]{16})$/;
const streamPattern = /^bnf1:r:m:(progress|partial)$/;
const reasoningPattern = /^bnf1:r:t:(off|streamed|kept)$/;

function replyChoiceOf(data: string): ReplyChoice | undefined {
  const stream = replyStreamSchema.safeParse(streamPattern.exec(data)?.[1]);
  if (stream.success) {
    return { stream: stream.data };
  }
  const reasoning = reasoningShownSchema.safeParse(reasoningPattern.exec(data)?.[1]);
  return reasoning.success ? { reasoning: reasoning.data } : undefined;
}
const limits: ReadonlySet<string> = new Set(halvableLimits);

function isHalvable(name: string): name is HalvableLimit {
  return limits.has(name);
}

/**
 * The callback data of a fast command's button, within Telegram's 64 bytes: `bnf1:t:h:<limit>`
 * for a `/limits` button, the limit named by its field, `bnf1:l:s:<en|zh>` for a `/lang` button,
 * `bnf1:r:m:<progress|partial>` and `bnf1:r:t:<off|streamed|kept>` for a `/replies` button,
 * `bnf1:m:s:<digest>` for an `/ai` button, and `bnf1:k:<a|r|c>:<id>` for a `/skills` button. It
 * names no agent: a press acts on the chat's.
 */
export function commandCallbackData(callback: CommandCallback): string {
  if (callback.kind === "skill") {
    return skillCallbackData(callback.choice);
  }
  if (callback.kind === "model") {
    return `bnf1:m:s:${callback.digest}`;
  }
  if (callback.kind === "replies") {
    const { choice } = callback;
    return "stream" in choice ? `bnf1:r:m:${choice.stream}` : `bnf1:r:t:${choice.reasoning}`;
  }
  return callback.kind === "halve" ? `bnf1:t:h:${callback.limit}` : `bnf1:l:s:${callback.locale}`;
}

// A `/skills` or `/replies` button's choice, which each reads from its own form of data.
function choiceOf(data: string): CommandCallback | undefined {
  const skill = skillChoiceOf(data);
  if (skill !== undefined) {
    return { kind: "skill", choice: skill };
  }
  const choice = replyChoiceOf(data);
  return choice === undefined ? undefined : { kind: "replies", choice };
}

function callbackOf(data: string): CommandCallback | undefined {
  const chosen = choiceOf(data);
  if (chosen !== undefined) {
    return chosen;
  }
  const digest = modelPattern.exec(data)?.[1];
  if (digest !== undefined) {
    return { kind: "model", digest };
  }
  const locale = languagePattern.exec(data)?.[1];
  if (locale === "en" || locale === "zh") {
    return { kind: "language", locale };
  }
  const limit = halvePattern.exec(data)?.[1];
  return limit !== undefined && isHalvable(limit) ? { kind: "halve", limit } : undefined;
}

/**
 * Parses a button press's callback data as a fast command's button. Only data in the exact form
 * {@link commandCallbackData} writes passes, for a limit a button may halve or a language
 * binference speaks; anything else is refused.
 */
export const commandCallbackSchema: z.ZodType<CommandCallback, string> = z
  .string()
  .transform((data, context): CommandCallback => {
    const callback = callbackOf(data);
    if (callback === undefined) {
      context.addIssue({ code: "custom", message: "No fast command's button carries this data." });
      return z.NEVER;
    }
    return callback;
  });
