import type { WorkLine } from "./status-preview.js";

/** The most characters one tool line of a status message shows. */
export const maxLineChars = 120;

/** The most characters the text an agent wrote before a tool shows, as one line. */
export const maxNarrationChars = 280;

// The most work lines a status message shows: the newest.
const maxLines = 8;

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

/**
 * The work lines with one more at the end: a line the same as the last one adds nothing, and only
 * the newest 8 stay.
 */
export function withLine(lines: readonly WorkLine[], line: WorkLine): readonly WorkLine[] {
  const last = lines.at(-1);
  if (line.text === "" || (last?.kind === line.kind && last.text === line.text)) {
    return lines;
  }
  return [...lines, line].slice(-maxLines);
}
