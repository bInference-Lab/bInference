// A private key block in PEM form, whatever its kind of key.
const privateKeyBlock =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;

// Lowercase words, and what may stand between the words of a written-down phrase: spaces, line
// breaks, and the numbers and marks of a numbered list.
const word = /[a-z]+/g;
const joiner = /^[\s\d.,):;-]*$/;

// The fewest words a recovery phrase has.
const leastPhraseWords = 12;

const hiddenKey = "[private key hidden]";
const hiddenPhrase = "[recovery phrase hidden]";

interface Span {
  readonly start: number;
  readonly end: number;
}

// The spans of the text where at least 12 words of the list follow each other with only list
// marks between them.
function phraseSpans(text: string, words: ReadonlySet<string>): readonly Span[] {
  const spans: Span[] = [];
  let run: { start: number; end: number; count: number } | undefined;
  for (const match of text.matchAll(word)) {
    const start = match.index;
    const end = start + match[0].length;
    const joined = run !== undefined && joiner.test(text.slice(run.end, start));
    if (!words.has(match[0])) {
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

/**
 * Hides what would let anyone take funds from a command's output before the model reads it
 * (decision 0378): private key blocks in PEM form, and recovery phrases, runs of at least 12 words
 * of `words`, the recovery phrase word list, with only spaces, line breaks and list marks between
 * them. A bare 64-character hex string stays, since a transaction hash looks the same.
 */
export function maskShellOutput(text: string, words: ReadonlySet<string>): string {
  const keysHidden = text.replace(privateKeyBlock, hiddenKey);
  const spans = phraseSpans(keysHidden, words);
  let masked = "";
  let from = 0;
  for (const span of spans) {
    masked += keysHidden.slice(from, span.start) + hiddenPhrase;
    from = span.end;
  }
  return masked + keysHidden.slice(from);
}
