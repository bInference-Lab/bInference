import { displayOutsideText } from "@binference/i18n";
import { escapeHtml } from "../format/escape-html.js";
import { richLinesOf } from "../format/markdown-lines.js";
import { richHtmlOf, richPlainOf } from "../format/rich-html.js";
import type { RichLine } from "../format/rich-line.js";
import { splitRichLines } from "../split/split-rich-lines.js";

/** One message of the agent's text: as Telegram HTML, and as plain text if Telegram refuses it. */
export interface ChatHtml {
  readonly html: string;
  /** The same words with no tags and no escapes, for a message sent with no parse mode. */
  readonly plain: string;
}

// A tab shows as spaces; every other character a reader cannot see shows as `\u{…}`.
const tabSpaces = "    ";

/**
 * The agent's text as rich lines: each line first goes through `displayOutsideText`, then its
 * Markdown is read into runs of the fixed set of tags (decision 0370), so markup the model writes,
 * a `<b>` among it, reads as text.
 */
export function shownLinesOf(text: string): readonly RichLine[] {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\t", tabSpaces)
    .split("\n")
    .map((line) => displayOutsideText(line, Number.POSITIVE_INFINITY));
  return richLinesOf(lines.join("\n").trim());
}

/** Lines as one message of Telegram HTML and the same words as plain text. */
export function chatHtmlOfLines(lines: readonly RichLine[]): ChatHtml {
  return { html: richHtmlOf(lines), plain: richPlainOf(lines) };
}

/**
 * The agent's text as Telegram messages of at most 4,096 characters each (spec 4, section 1),
 * drawn from {@link shownLinesOf}. A text with nothing to show gives no message.
 */
export function chatHtmlOf(text: string): readonly ChatHtml[] {
  return splitRichLines(shownLinesOf(text))
    .map(chatHtmlOfLines)
    .filter((piece) => piece.plain.trim() !== "");
}

/** A status line of the agent's turn as Telegram HTML: in italics, quieter than its words. */
export function statusHtmlOf(line: string): string {
  return `<i>${escapeHtml(line)}</i>`;
}
