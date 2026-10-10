import type { MessageLocale } from "@binference/i18n";
import { z } from "zod";

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
 * the owner's language from `/lang`.
 */
export type CommandCallback =
  | { readonly kind: "halve"; readonly limit: HalvableLimit }
  | { readonly kind: "language"; readonly locale: MessageLocale };

const halvePattern = /^bnf1:t:h:(\w{1,32})$/;
const languagePattern = /^bnf1:l:s:(en|zh)$/;
const limits: ReadonlySet<string> = new Set(halvableLimits);

function isHalvable(name: string): name is HalvableLimit {
  return limits.has(name);
}

/**
 * The callback data of a fast command's button, within Telegram's 64 bytes: `bnf1:t:h:<limit>`
 * for a `/limits` button, the limit named by its field, and `bnf1:l:s:<en|zh>` for a `/lang`
 * button. It names no agent: a press acts on the only one.
 */
export function commandCallbackData(callback: CommandCallback): string {
  return callback.kind === "halve" ? `bnf1:t:h:${callback.limit}` : `bnf1:l:s:${callback.locale}`;
}

function callbackOf(data: string): CommandCallback | undefined {
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
