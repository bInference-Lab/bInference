import { messages } from "./messages.js";

/**
 * The version of the disclaimer and the privacy statement (`disclaimer.*`, spec 4 section 9).
 * A change of meaning in either text raises it, so every owner accepts the new text before an
 * agent goes live again; the engine stores the version an owner accepted.
 */
export const disclaimerVersion = 2;

// The phrase in every language binference speaks, as a person may type it.
const phrases: ReadonlySet<string> = new Set(
  Object.values(messages).flatMap((catalog) => {
    const phrase = catalog["disclaimer.phrase"];
    return phrase === undefined ? [] : [phrase.toLowerCase()];
  }),
);

/**
 * Whether an answer accepts the disclaimer: its phrase in either language, in any letter case,
 * with spaces around it.
 */
export function isDisclaimerPhrase(answer: string): boolean {
  return phrases.has(answer.trim().toLowerCase());
}
