import { BinferenceError } from "@binference/core";
import { z } from "zod";

/** What a card button asks for: Confirm, Cancel or Details. */
export type CardDecision = "confirm" | "deny" | "details";

/** A card button's callback, as its data carries it (spec 4, section 2). */
export interface CardCallback {
  readonly decision: CardDecision;
  /** The card version's random reference: 12 bytes in base64url, never a guessable id. */
  readonly ref: string;
}

const codes: Readonly<Record<CardDecision, string>> = { confirm: "y", deny: "n", details: "d" };
const decisions: Readonly<Record<string, CardDecision>> = { y: "confirm", n: "deny", d: "details" };
const refPattern = /^[\w-]{16}$/;
const dataPattern = /^bnf1:c:([ynd]):([\w-]{16})$/;

/**
 * The callback data of a card button: `bnf1:c:<decision>:<ref>`, 25 bytes, within Telegram's 64.
 * Throws `telegram.bad_card_ref` for a reference that is not 12 bytes in base64url.
 */
export function cardCallbackData(callback: CardCallback): string {
  if (!refPattern.test(callback.ref)) {
    throw new BinferenceError({
      code: "telegram.bad_card_ref",
      message: "A card's callback reference is 12 random bytes in base64url.",
    });
  }
  return `bnf1:c:${codes[callback.decision]}:${callback.ref}`;
}

/**
 * Parses a button press's callback data as a card callback. Only data in the exact form
 * {@link cardCallbackData} writes passes; anything else, however close, is refused.
 */
export const cardCallbackSchema: z.ZodType<CardCallback, string> = z
  .string()
  .regex(dataPattern, { message: "Expected bnf1:c:<y|n|d>:<12 bytes in base64url>." })
  .transform((data): CardCallback => {
    const [, code = "", ref = ""] = dataPattern.exec(data) ?? [];
    return { decision: decisions[code] ?? "details", ref };
  });
