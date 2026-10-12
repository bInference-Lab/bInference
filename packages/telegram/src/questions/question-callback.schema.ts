import { z } from "zod";

/** A press of a button of the agent's question: the choice's place and the question's reference. */
export interface QuestionCallback {
  /** The place of the choice in the question, `0` to `3`. */
  readonly choice: number;
  /** The question's random reference: 12 bytes in base64url, never a guessable id. */
  readonly ref: string;
}

const dataPattern = /^bnf1:q:([0-3]):([\w-]{16})$/;

/**
 * The callback data of a question's button: `bnf1:q:<choice>:<ref>`, 25 bytes, within Telegram's
 * 64 (spec 4, section 2).
 */
export function questionCallbackData(callback: QuestionCallback): string {
  return `bnf1:q:${String(callback.choice)}:${callback.ref}`;
}

/**
 * Parses a button press's callback data as a question's button. Only data in the exact form
 * {@link questionCallbackData} writes passes; anything else is refused.
 */
export const questionCallbackSchema: z.ZodType<QuestionCallback, string> = z
  .string()
  .regex(dataPattern, { message: "Expected bnf1:q:<0-3>:<12 bytes in base64url>." })
  .transform((data): QuestionCallback => {
    const [, choice = "0", ref = ""] = dataPattern.exec(data) ?? [];
    return { choice: Number(choice), ref };
  });
