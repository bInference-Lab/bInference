import type { LocaleMessages, MessageProblem } from "./message-files.js";

/** A closed list of codes whose messages one area holds, keyed by the code itself. */
export interface CodeMessages {
  readonly locale: string;
  /** The area file whose keys are the codes, such as `error` for protocol error codes. */
  readonly area: string;
  readonly messages: LocaleMessages;
  readonly codes: readonly string[];
}

const missingCode = "The code has no message; add one in every language.";
const extraCode = "No code has this key; remove it or fix its spelling.";

/**
 * Checks that an area holds a message for every code and no key that is not a code. Run it on
 * the source language; the catalog check carries every key to the other languages.
 */
export function checkCodeMessages(options: CodeMessages): readonly MessageProblem[] {
  const { locale, area } = options;
  const entries = options.messages[area] ?? {};
  const codes = new Set(options.codes);
  const missing = options.codes
    .filter((code) => entries[code] === undefined)
    .map((key): MessageProblem => ({ locale, area, key, text: missingCode }));
  const extra = Object.keys(entries)
    .filter((key) => !codes.has(key))
    .map((key): MessageProblem => ({ locale, area, key, text: extraCode }));
  return [...missing, ...extra];
}
