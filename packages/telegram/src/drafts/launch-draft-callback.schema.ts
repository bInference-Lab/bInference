import { z } from "zod";

/** A press of a launch draft's button: Start launch or Drop, and the draft's reference. */
export interface LaunchDraftCallback {
  readonly start: boolean;
  /** The draft's random reference: 12 bytes in base64url, never a guessable id. */
  readonly ref: string;
}

const dataPattern = /^bnf1:s:([yn]):([\w-]{16})$/;

/**
 * The callback data of a launch draft's button: `bnf1:s:<y|n>:<ref>`, 25 bytes, within Telegram's
 * 64 (spec 4, section 2).
 */
export function launchDraftCallbackData(callback: LaunchDraftCallback): string {
  return `bnf1:s:${callback.start ? "y" : "n"}:${callback.ref}`;
}

/**
 * Parses a button press's callback data as a launch draft's button. Only data in the exact form
 * {@link launchDraftCallbackData} writes passes; anything else is refused.
 */
export const launchDraftCallbackSchema: z.ZodType<LaunchDraftCallback, string> = z
  .string()
  .regex(dataPattern, { message: "Expected bnf1:s:<y|n>:<12 bytes in base64url>." })
  .transform((data): LaunchDraftCallback => {
    const [, decision = "n", ref = ""] = dataPattern.exec(data) ?? [];
    return { start: decision === "y", ref };
  });
