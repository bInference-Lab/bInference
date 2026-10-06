import { secretKindsIn } from "@binference/core";
import { recoveryWords } from "./recovery-words.js";

/** The fewest words a recovery phrase has. */
const phraseWords = 12;
/** The most words a recovery phrase has. */
const maxPhraseWords = 24;
// A private key written without its 0x prefix, as wallets export it.
const bareKey = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i;
// A Chinese recovery phrase: 12 or more single Han characters, one space between each.
const hanPhrase = /(?<!\p{Script=Han})(?:\p{Script=Han} ){11,}\p{Script=Han}(?!\p{Script=Han})/u;
// Whitespace and punctuation, the Chinese enumeration comma among it.
const wordBreaks = /[\s\p{P}]+/gu;

function holdsKeyOrToken(text: string): boolean {
  const kinds = secretKindsIn(text).filter((kind) => kind !== "recoveryPhrase");
  return kinds.length > 0 || bareKey.test(text);
}

function longestRun(words: readonly string[]): number {
  return words.reduce(
    (runs, word) => {
      const current = recoveryWords.has(word) ? runs.current + 1 : 0;
      return { current, longest: Math.max(runs.longest, current) };
    },
    { current: 0, longest: 0 },
  ).longest;
}

// Words of the BIP-39 list, however they were pasted: one a line, numbered, capitalized, or in
// full-width letters. A phrase pasted alone may hold one mistyped word.
function holdsWordPhrase(text: string): boolean {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word !== "");
  const listed = words.filter((word) => recoveryWords.has(word)).length;
  const isPhraseAlone =
    words.length >= phraseWords && words.length <= maxPhraseWords && listed >= words.length - 1;
  return isPhraseAlone || longestRun(words) >= phraseWords;
}

/**
 * Whether a chat text looks like a secret: a recovery phrase (12 or more words of the BIP-39
 * English list, or 12 or more single Chinese characters), a private key with or without `0x`, an
 * owner key code, a bot token or a binference key. It errs on the side of a match: a pasted
 * transaction hash looks like a private key.
 */
export function looksLikeSecret(text: string): boolean {
  return (
    holdsKeyOrToken(text) ||
    holdsWordPhrase(text) ||
    hanPhrase.test(text.normalize("NFKC").replace(wordBreaks, " "))
  );
}
