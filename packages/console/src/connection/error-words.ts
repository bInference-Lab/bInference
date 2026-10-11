import { protocolErrorCodes } from "@binference/protocol";
import type { Words } from "../i18n/console-text";

const known: ReadonlySet<string> = new Set(protocolErrorCodes);

/**
 * What a failed call says to the owner: the message of its protocol error code, such as
 * `limit.daily_cap`, which names the next step; any other fault points to the engine's log.
 */
export function errorWords(text: Words, error: Error): string {
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return code !== undefined && known.has(code)
    ? text(`error.${code}`)
    : text("console.error.other");
}
