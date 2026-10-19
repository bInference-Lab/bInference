import { displayOutsideText, type Formatter, type MessageValues } from "@binference/i18n";
import { protocolErrorCodes } from "@binference/protocol";
import type { ScreenLine } from "./chat-screen.js";

// The most characters of the agent's name a line shows (spec 4, section 1).
const nameLength = 40;
const knownCodes: ReadonlySet<string> = new Set(protocolErrorCodes);

/** A message of any area by its full key, such as `tui.closed`, in the owner's language. */
export type Words = (key: string, values?: MessageValues) => string;

/** The formatter's messages as {@link Words}. */
export function wordsOf(formatter: Formatter): Words {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return (key, values) => formatter.message(key, values);
}

/** The agent's name as the chat writes it: cut, every character a reader cannot see written out. */
export function agentNameText(name: string): string {
  return displayOutsideText(name, nameLength);
}

/**
 * Text set outside binference, such as the agent's words, as the lines it holds. Every other
 * character a reader cannot see, or that moves the cursor, shows as `\u{…}`, so a model's words
 * never steer the terminal. Longer than `most` characters, it is cut and ends with `…`.
 */
function outsideLines(text: string, most = Number.POSITIVE_INFINITY): readonly string[] {
  const characters = Array.from(text);
  const kept = characters.length > most ? `${characters.slice(0, most - 1).join("")}…` : text;
  return kept.split(/\r?\n/).map((line) => displayOutsideText(line, Number.POSITIVE_INFINITY));
}

/** What the owner or the agent said, under the speaker's name, each further line indented. */
export function saidLines(speaker: string, text: string): readonly ScreenLine[] {
  const [first = "", ...rest] = outsideLines(text);
  return [{ text: `${speaker}: ${first}` }, ...rest.map((line) => ({ text: `  ${line}` }))];
}

function codeOf(error: ErrorOptions["cause"]): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * Why a call failed, in the owner's language: the message of its protocol error code, which
 * names the next step; any other fault points to the log.
 */
export function failureText(words: Words, error: ErrorOptions["cause"]): string {
  const code = codeOf(error);
  return code !== undefined && knownCodes.has(code)
    ? words(`error.${code}`)
    : words("tui.otherError");
}
