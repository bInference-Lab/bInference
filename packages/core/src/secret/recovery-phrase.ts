import { recoveryWords } from "./recovery-words.js";

/** Where a recovery phrase sits in a text: from `start` up to, but not including, `end`. */
export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

// Lowercase words, and what may stand between the words of a written-down phrase: spaces, line
// breaks, and the numbers and marks of a numbered list.
const word = /[a-z]+/g;
const joiner = /^[\s\d.,):;-]*$/;

/** The fewest words a recovery phrase has. */
export const leastPhraseWords = 12;

/**
 * The spans of a text that hold a recovery phrase: runs of at least 12 words of the BIP-39
 * English list with only spaces, line breaks and the numbers and marks of a list between them.
 * A run takes the listed words after its twelfth too. Prose that mixes in other words, and a
 * 64-digit hex string such as a transaction hash, hold none.
 */
export function recoveryPhraseSpans(text: string): readonly TextSpan[] {
  const spans: TextSpan[] = [];
  let run: { start: number; end: number; count: number } | undefined;
  for (const match of text.matchAll(word)) {
    const start = match.index;
    const end = start + match[0].length;
    const joined = run !== undefined && joiner.test(text.slice(run.end, start));
    if (!recoveryWords.has(match[0])) {
      run = undefined;
    } else if (run !== undefined && joined) {
      run = { ...run, end, count: run.count + 1 };
    } else {
      run = { start, end, count: 1 };
    }
    if (run?.count === leastPhraseWords) {
      spans.push({ start: run.start, end: run.end });
    } else if (run !== undefined && run.count > leastPhraseWords) {
      spans[spans.length - 1] = { start: run.start, end: run.end };
    }
  }
  return spans;
}

/** Whether a text holds a recovery phrase, as {@link recoveryPhraseSpans} finds one. */
export function holdsRecoveryPhrase(text: string): boolean {
  return recoveryPhraseSpans(text).length > 0;
}
