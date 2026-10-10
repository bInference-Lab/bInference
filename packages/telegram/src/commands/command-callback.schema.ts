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

/** What a fast command's button asks for (spec 4, section 2): halve a limit of `/limits`. */
export interface CommandCallback {
  readonly kind: "halve";
  readonly limit: HalvableLimit;
}

const dataPattern = /^bnf1:t:h:(\w{1,32})$/;
const limits: ReadonlySet<string> = new Set(halvableLimits);

function isHalvable(name: string): name is HalvableLimit {
  return limits.has(name);
}

/**
 * The callback data of a `/limits` button: `bnf1:t:h:<limit>`, the limit named by its field, at
 * most 41 bytes, within Telegram's 64. It names no agent: a press acts on the only one.
 */
export function commandCallbackData(callback: CommandCallback): string {
  return `bnf1:t:h:${callback.limit}`;
}

/**
 * Parses a button press's callback data as a fast command's button. Only data in the exact form
 * {@link commandCallbackData} writes passes, for a limit a button may halve; anything else is
 * refused.
 */
export const commandCallbackSchema: z.ZodType<CommandCallback, string> = z
  .string()
  .regex(dataPattern, { message: "Expected bnf1:t:h:<limit>." })
  .transform((data, context): CommandCallback => {
    const limit = dataPattern.exec(data)?.[1] ?? "";
    if (!isHalvable(limit)) {
      context.addIssue({ code: "custom", message: "No /limits button halves this limit." });
      return z.NEVER;
    }
    return { kind: "halve", limit };
  });
