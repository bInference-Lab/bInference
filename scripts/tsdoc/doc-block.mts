const suppression = /^\s*\/\/\s*(?:oxlint|eslint)-disable/;
const sentence = /[A-Za-z][\w'-]*\s+(?:[^.!?]|[.!?](?=\S))*[.!?](?:\s|$)/;

// The summary is the text before the first block tag, with the comment markers taken out.
function summaryOf(block: readonly string[]): string {
  const text: string[] = [];
  for (const raw of block) {
    const line = raw
      .trim()
      .replace(/^\/\*\*/, "")
      .replace(/\*\/$/, "")
      .replace(/^\*\s?/, "")
      .trim();
    if (line.startsWith("@")) {
      break;
    }
    text.push(line);
  }
  return text.join(" ").trim();
}

// The last line of the comment above a declaration, past suppression comments; -1 for none.
function blockEnd(lines: readonly string[], line: number): number {
  let end = line - 1;
  while (end >= 0 && suppression.test(lines[end] ?? "")) {
    end -= 1;
  }
  return end >= 0 && (lines[end] ?? "").trim().endsWith("*/") ? end : -1;
}

function blockStart(lines: readonly string[], end: number): number {
  let start = end;
  while (start > 0 && !(lines[start] ?? "").trim().startsWith("/*")) {
    start -= 1;
  }
  return start;
}

/**
 * Whether the declaration at a 0-based line carries a TSDoc block whose summary holds a sentence.
 * Suppression comments between the block and the declaration are skipped.
 */
export function hasDocSentence(lines: readonly string[], line: number): boolean {
  const end = blockEnd(lines, line);
  if (end === -1) {
    return false;
  }
  const block = lines.slice(blockStart(lines, end), end + 1);
  return (block[0] ?? "").trim().startsWith("/**") && sentence.test(summaryOf(block));
}
