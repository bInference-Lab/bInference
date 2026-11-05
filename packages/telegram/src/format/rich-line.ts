/**
 * A style on a run of the agent's text, outermost first. Each kind maps to one tag of Telegram's
 * HTML: `bold` to `b`, `italic` to `i`, `strike` to `s`, `code` to `code`, `spoiler` to
 * `tg-spoiler`, and `link` to `a` with an `http:` or `https:` address only.
 */
export type RichMark =
  | { readonly kind: "bold" | "italic" | "strike" | "code" | "spoiler" }
  | { readonly kind: "link"; readonly href: string };

/** A run of plain text with the styles it shows in. The text is not escaped yet. */
export interface RichRun {
  readonly text: string;
  readonly marks: readonly RichMark[];
}

/**
 * The block a line sits in: plain text, a quote or a code block. Lines of one quote or code block
 * share its `block` number, so two blocks in a row stay apart. A code block's `language` holds
 * letters and digits only.
 */
export type RichBlock =
  | { readonly kind: "text" }
  | { readonly kind: "quote"; readonly block: number }
  | { readonly kind: "code"; readonly block: number; readonly language?: string };

/** One line of the agent's text as runs, in its block. */
export interface RichLine {
  readonly block: RichBlock;
  readonly runs: readonly RichRun[];
}

/** Whether two styles are the same tag with the same address. */
export function isSameMark(left: RichMark, right: RichMark): boolean {
  if (left.kind === "link" && right.kind === "link") {
    return left.href === right.href;
  }
  return left.kind === right.kind;
}

/** Whether two lines sit in the same block, so they render inside one tag. */
export function isSameBlock(left: RichBlock, right: RichBlock): boolean {
  if (left.kind === "text" || right.kind === "text") {
    return left.kind === right.kind;
  }
  return left.kind === right.kind && left.block === right.block;
}

/** Whether a line is an empty line of plain text: a paragraph break. */
export function isBlankLine(line: RichLine): boolean {
  return line.block.kind === "text" && line.runs.every((run) => run.text.trim() === "");
}
