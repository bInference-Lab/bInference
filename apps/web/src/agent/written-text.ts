/** How long the agent takes to write one letter of its status, in seconds. */
const letterSeconds = 0.034;

const letters = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function lettersOf(text: string): readonly string[] {
  return Array.from(letters.segment(text), (part) => part.segment);
}

/**
 * The part of `text` the agent has written `elapsed` seconds after it began: one letter at once,
 * then one more each beat. A letter is what a reader sees as one, so Chinese is written as it is
 * read.
 */
export function writtenText(text: string, elapsed: number): string {
  return lettersOf(text)
    .slice(0, Math.max(1, Math.floor(elapsed / letterSeconds) + 1))
    .join("");
}

/** How long writing all of `text` takes, in seconds. */
export function writingSeconds(text: string): number {
  return lettersOf(text).length * letterSeconds;
}
