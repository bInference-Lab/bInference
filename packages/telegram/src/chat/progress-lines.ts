/** The most characters one line of a status message shows. */
export const maxLineChars = 120;

/**
 * A text as one line of at most `maxChars` characters, counted by code point: its spaces and line
 * breaks folded into single spaces, and a longer text cut with `…`, at a word's end when one lies
 * past 60% of the line.
 */
export function compactLine(text: string, maxChars: number): string {
  const folded = text.replaceAll(/\s+/gu, " ").trim();
  const characters = Array.from(folded);
  if (characters.length <= maxChars) {
    return folded;
  }
  const head = characters
    .slice(0, maxChars - 1)
    .join("")
    .trimEnd();
  const wordEnd = head.search(/\s+\S*$/u);
  return wordEnd > Math.floor(maxChars * 0.6) ? `${head.slice(0, wordEnd).trimEnd()}…` : `${head}…`;
}
