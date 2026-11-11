import { type ProtocolId, protocolIdSchema, type ShellAnswer } from "@binference/protocol";
import { z } from "zod";

/** A press of a shell request's button: the owner's answer and the request it answers. */
export interface ShellRequestCallback {
  readonly answer: ShellAnswer;
  readonly request: ProtocolId<"shellRequest">;
}

const answers: Readonly<Record<string, ShellAnswer>> = { o: "once", a: "always", n: "refuse" };
const letters: Readonly<Record<ShellAnswer, string>> = { once: "o", always: "a", refuse: "n" };

const dataPattern = /^bnf1:x:([oan]):(shq_[0-9a-f-]{36})$/u;

/**
 * The callback data of a shell request's button: `bnf1:x:<o|a|n>:<request>`, 49 bytes, within
 * Telegram's 64 (spec 4, section 2; decision 0409).
 */
export function shellRequestCallbackData(callback: ShellRequestCallback): string {
  return `bnf1:x:${letters[callback.answer]}:${callback.request}`;
}

/**
 * Parses a button press's callback data as a shell request's button. Only data in the exact form
 * {@link shellRequestCallbackData} writes passes; anything else is refused.
 */
export const shellRequestCallbackSchema: z.ZodType<ShellRequestCallback, string> = z
  .string()
  .regex(dataPattern, { message: "Expected bnf1:x:<o|a|n>:<shell request id>." })
  .transform((data): ShellRequestCallback => {
    const [, letter = "n", request = ""] = dataPattern.exec(data) ?? [];
    return {
      answer: answers[letter] ?? "refuse",
      request: protocolIdSchema("shellRequest").parse(request),
    };
  });
