import { inlineRunsOf } from "./markdown-inline.js";
import type { RichBlock, RichLine, RichRun } from "./rich-line.js";
import { isTableDelimiter, tableCellsOf, tableGridOf } from "./table-grid.js";

/** A fence that opens a code block: its character, its length and the language it names. */
interface Fence {
  readonly character: string;
  readonly length: number;
  readonly language?: string;
}

/** The lines read so far, and the number for the next quote or code block. */
interface Reading {
  /** Keeps lines read, in order. */
  readonly add: (...lines: readonly RichLine[]) => void;
  readonly nextBlock: () => number;
}

const fenceOpen = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const fenceClose = /^ {0,3}(`{3,}|~{3,}) *$/u;
const languageName = /^[A-Za-z0-9]{1,32}$/u;
const quoteMark = /^ {0,3}> ?/u;
const heading = /^ {0,3}#{1,6} +(.*?)(?: +#+)? *$/u;
const rule = /^ {0,3}([-*_])(?: *\1){2,} *$/u;
const bullet = /^( *)[-*+] +(.*)$/u;
const numbered = /^( *)(\d{1,9}[.)]) +(.*)$/u;
// A nested list item is drawn two spaces further in per level, up to this many levels.
const maxListLevel = 6;

function fenceOf(line: string): Fence | undefined {
  const match = fenceOpen.exec(line);
  const [, marks = "", info = ""] = match ?? [];
  if (match === null || (marks.startsWith("`") && info.includes("`"))) {
    return undefined;
  }
  const language = info.trim().split(/\s+/u)[0] ?? "";
  const fence = { character: marks.charAt(0), length: marks.length };
  return languageName.test(language) ? { ...fence, language } : fence;
}

function closesFence(line: string, fence: Fence): boolean {
  const marks = fenceClose.exec(line)?.[1] ?? "";
  return marks.startsWith(fence.character) && marks.length >= fence.length;
}

// Reads a code block from its opening fence; one left open runs to the end of the text.
function readCode(source: readonly string[], at: number, reading: Reading): number {
  const fence = fenceOf(source[at] ?? "") ?? { character: "`", length: 3 };
  const { language } = fence;
  const block: RichBlock = {
    kind: "code",
    block: reading.nextBlock(),
    ...(language !== undefined && { language }),
  };
  let next = at + 1;
  while (next < source.length && !closesFence(source[next] ?? "", fence)) {
    const text = source[next] ?? "";
    reading.add({ block, runs: text === "" ? [] : [{ text, marks: [] }] });
    next += 1;
  }
  return next + 1;
}

function unquoted(line: string): string {
  let rest = line;
  while (quoteMark.test(rest)) {
    rest = rest.replace(quoteMark, "");
  }
  return rest;
}

function listPrefix(indent: string, marker: string): string {
  const level = Math.min(maxListLevel, Math.floor(indent.length / 2));
  return `${"  ".repeat(level)}${marker} `;
}

function listLine(line: string): readonly RichRun[] | undefined {
  const [, bulletIndent, bulletText] = bullet.exec(line) ?? [];
  if (bulletIndent !== undefined && bulletText !== undefined) {
    return [{ text: listPrefix(bulletIndent, "•"), marks: [] }, ...inlineRunsOf(bulletText)];
  }
  const [, numberIndent, number, numberText] = numbered.exec(line) ?? [];
  if (numberIndent !== undefined && number !== undefined && numberText !== undefined) {
    return [{ text: listPrefix(numberIndent, number), marks: [] }, ...inlineRunsOf(numberText)];
  }
  return undefined;
}

// One line that stands alone: an empty line, a heading, a rule, or a list item.
function singleLine(line: string): readonly RichRun[] | undefined {
  if (line.trim() === "" || rule.test(line)) {
    return [];
  }
  const title = heading.exec(line)?.[1];
  if (title !== undefined && title !== "") {
    return inlineRunsOf(title);
  }
  return listLine(line);
}

// Splits a paragraph's runs at its line breaks, each line keeping its runs' styles.
function paragraphLines(text: string, block: RichBlock): readonly RichLine[] {
  const lines: RichRun[][] = [[]];
  for (const run of inlineRunsOf(text)) {
    run.text.split("\n").forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (part !== "") {
        lines.at(-1)?.push({ text: part, marks: run.marks });
      }
    });
  }
  return lines.map((runs: readonly RichRun[]) => ({ block, runs }));
}

// Reads lines of text: each line that stands alone, and paragraphs of the lines between them.
function readFlow(source: readonly string[], block: RichBlock, reading: Reading): void {
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) {
      reading.add(...paragraphLines(paragraph.join("\n"), block));
      paragraph = [];
    }
  };
  for (const line of source) {
    const runs = singleLine(line);
    if (runs === undefined) {
      paragraph.push(line);
    } else {
      endParagraph();
      reading.add({ block, runs });
    }
  }
  endParagraph();
}

function readQuote(source: readonly string[], at: number, reading: Reading): number {
  let next = at;
  while (next < source.length && quoteMark.test(source[next] ?? "")) {
    next += 1;
  }
  const block: RichBlock = { kind: "quote", block: reading.nextBlock() };
  readFlow(source.slice(at, next).map(unquoted), block, reading);
  return next;
}

// A table starts at a row with a `|`, right above a delimiter row of as many cells.
function isTableStart(source: readonly string[], at: number): boolean {
  const [head = "", delimiter = ""] = source.slice(at, at + 2);
  return (
    head.includes("|") &&
    isTableDelimiter(delimiter) &&
    tableCellsOf(head).length === tableCellsOf(delimiter).length
  );
}

// Reads a table up to the first line without a `|`, drawn as a code block's fixed-width grid.
function readTable(source: readonly string[], at: number, reading: Reading): number {
  let next = at + 2;
  while (next < source.length && (source[next] ?? "").includes("|")) {
    next += 1;
  }
  const rows = source.slice(at + 2, next).map(tableCellsOf);
  const block: RichBlock = { kind: "code", block: reading.nextBlock() };
  for (const text of tableGridOf(tableCellsOf(source[at] ?? ""), rows)) {
    reading.add({ block, runs: [{ text, marks: [] }] });
  }
  return next;
}

function isText(source: readonly string[], at: number): boolean {
  const line = source[at] ?? "";
  return fenceOf(line) === undefined && !quoteMark.test(line) && !isTableStart(source, at);
}

function readText(source: readonly string[], at: number, reading: Reading): number {
  let next = at;
  while (next < source.length && isText(source, next)) {
    next += 1;
  }
  readFlow(source.slice(at, next), { kind: "text" }, reading);
  return next;
}

/**
 * Reads the agent's Markdown into lines for every surface: fenced code blocks, quotes, tables as a code
 * block's fixed-width grid, headings as plain lines, bullet items as `•` lines and numbered items
 * with their numbers, nested items two spaces in per level, and paragraphs with their inline
 * styles. A fence left open runs to the end; anything that is no Markdown stays as its text.
 */
export function richLinesOf(text: string): readonly RichLine[] {
  const source = text.split("\n");
  let blocks = 0;
  const read: RichLine[] = [];
  const reading: Reading = {
    add: (...lines) => {
      read.push(...lines);
    },
    nextBlock: () => (blocks += 1),
  };
  let at = 0;
  while (at < source.length) {
    const line = source[at] ?? "";
    if (fenceOf(line) !== undefined) {
      at = readCode(source, at, reading);
    } else if (quoteMark.test(line)) {
      at = readQuote(source, at, reading);
    } else if (isTableStart(source, at)) {
      at = readTable(source, at, reading);
    } else {
      at = readText(source, at, reading);
    }
  }
  return read;
}
