import { protocolErrorCodes } from "@binference/protocol";
import type { Words } from "../i18n/console-text";

const known: ReadonlySet<string> = new Set(protocolErrorCodes);

/**
 * What a protocol error code says to the owner, such as `limit.daily_cap`'s message, which names
 * the next step; a code this version does not know, or none, points to the engine's log.
 */
export function codeWords(text: Words, code: string | undefined): string {
  return code !== undefined && known.has(code)
    ? text(`error.${code}`)
    : text("console.error.other");
}

/**
 * What a failed call says to the owner: the message of its protocol error code, such as
 * `limit.daily_cap`, which names the next step; any other fault points to the engine's log.
 */
export function errorWords(text: Words, error: Error): string {
  return codeWords(
    text,
    "code" in error && typeof error.code === "string" ? error.code : undefined,
  );
}
