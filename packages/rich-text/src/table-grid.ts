import { inlineRunsOf } from "./markdown-inline.js";

// Telegram's fixed-width font gives these code points two cells: East Asian wide letters.
const wideRanges: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x9fff],
  [0xa000, 0xa4ff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x2fa1f],
];
const emoji = /\p{Emoji_Presentation}/u;
const unseen = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Format}|\p{Mark})$/u;
const delimiterCell = /^:?-+:?$/u;
// A column is at least this wide, so a narrow table still reads as one.
const leastWidth = 3;

function cellsOf(character: string): number {
  const point = character.codePointAt(0) ?? 0;
  if (emoji.test(character) || wideRanges.some(([low, high]) => point >= low && point <= high)) {
    return 2;
  }
  return unseen.test(character) ? 0 : 1;
}

function widthOf(text: string): number {
  return Array.from(text).reduce((width, character) => width + cellsOf(character), 0);
}

function pad(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - widthOf(text)))}`;
}

/** A row's cells, split at each `|` a backslash does not escape, the outer pipes left out. */
export function tableCellsOf(line: string): readonly string[] {
  const trimmed = line
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "");
  return trimmed.split(/(?<!\\)\|/u).map((cell) => cell.replaceAll("\\|", "|").trim());
}

/** Whether a line is a table's delimiter row, such as `| --- | :--: |`. */
export function isTableDelimiter(line: string): boolean {
  return line.includes("-") && tableCellsOf(line).every((cell) => delimiterCell.test(cell));
}

// A cell's words with its Markdown marks read and dropped: a grid shows plain text.
function plainOf(cell: string): string {
  return inlineRunsOf(cell)
    .map((run) => run.text)
    .join("");
}

/**
 * A Markdown table as the lines of a fixed-width grid: `| a   | b   |`, every column padded to its
 * widest cell (at least 3), a `| --- |` line under the header, cells as plain text. East Asian
 * wide letters and emoji count two cells.
 */
export function tableGridOf(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): readonly string[] {
  const table = [header, ...rows].map((row) => row.map(plainOf));
  const columns = Math.max(...table.map((row: readonly string[]) => row.length));
  const widths = [...Array.from({ length: columns }).keys()].map((column) =>
    Math.max(leastWidth, ...table.map((row: readonly string[]) => widthOf(row[column] ?? ""))),
  );
  const line = (row: readonly string[]): string =>
    `| ${widths.map((width, column) => pad(row[column] ?? "", width)).join(" | ")} |`;
  const divider = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  const [head = [], ...body] = table;
  return [line(head), divider, ...body.map(line)];
}
