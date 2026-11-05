import { escapeHtml } from "../format/escape-html.js";
import { blockTags, marksLength, richHtmlOf } from "../format/rich-html.js";
import { isBlankLine, type RichLine, type RichRun } from "../format/rich-line.js";
import { maxMessageLength } from "./split-text.js";

// Cuts a line too long for one message into lines that each fit, at whole characters. Each run
// counts its tags in full, so a piece never renders longer than it counts.
function cutLine(line: RichLine, maxLength: number): readonly RichLine[] {
  if (richHtmlOf([line]).length <= maxLength) {
    return [line];
  }
  const [open, close] = blockTags(line.block);
  const budget = maxLength - open.length - close.length;
  const pieces: RichRun[][] = [[]];
  let used = 0;
  for (const run of line.runs) {
    const tags = marksLength(run.marks);
    let text = "";
    used += tags;
    for (const character of run.text) {
      const cost = escapeHtml(character).length;
      if (used + cost > budget) {
        pieces.at(-1)?.push({ text, marks: run.marks });
        pieces.push([]);
        [used, text] = [tags, ""];
      }
      text += character;
      used += cost;
    }
    pieces.at(-1)?.push({ text, marks: run.marks });
  }
  return pieces.map((runs) => ({ block: line.block, runs: runs.filter((run) => run.text !== "") }));
}

// Where a full message ends: at its last paragraph break once at least half of it is filled,
// else after its last line.
function cutAt(piece: readonly RichLine[], maxLength: number): number {
  for (let index = piece.length - 1; index > 0; index -= 1) {
    const line = piece[index];
    const isBreak = line !== undefined && isBlankLine(line);
    if (isBreak && richHtmlOf(piece.slice(0, index)).length >= maxLength / 2) {
      return index;
    }
  }
  return piece.length;
}

function trimmed(piece: readonly RichLine[]): readonly RichLine[] {
  const first = piece.findIndex((line) => !isBlankLine(line));
  const last = piece.findLastIndex((line) => !isBlankLine(line));
  return first === -1 ? [] : piece.slice(first, last + 1);
}

/**
 * Splits the agent's lines into messages whose Telegram HTML holds at most `maxLength`
 * characters, a paragraph break preferred over a line break, and a line longer than a message cut
 * at whole characters. Each message renders on its own, so a style or block cut across two
 * messages closes at the end of the first and opens again in the second.
 */
export function splitRichLines(
  lines: readonly RichLine[],
  maxLength: number = maxMessageLength,
): readonly (readonly RichLine[])[] {
  const pieces: (readonly RichLine[])[] = [];
  let current: RichLine[] = [];
  for (const line of lines.flatMap((given) => cutLine(given, maxLength))) {
    current.push(line);
    if (richHtmlOf(current).length <= maxLength) {
      continue;
    }
    current.pop();
    const at = cutAt(current, maxLength);
    pieces.push(current.slice(0, at));
    current = current.slice(at);
    current.push(line);
    if (richHtmlOf(current).length > maxLength) {
      pieces.push(current.slice(0, -1));
      current = [line];
    }
  }
  pieces.push(current);
  return pieces.map(trimmed).filter((piece) => piece.length > 0);
}
