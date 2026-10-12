import { displayOutsideText } from "@binference/i18n";
import { escapeHtml } from "../format/escape-html.js";
import { splitText } from "../split/split-text.js";

// A tab shows as spaces; every other character a reader cannot see shows as `\u{…}`.
const tabSpaces = "    ";

/**
 * The agent's text as Telegram HTML messages of at most 4,096 characters each, split at line
 * breaks (spec 4, section 1). The model writes it, so it is shown as text and never as markup:
 * each line goes through `displayOutsideText`, then each message is escaped whole, so a `<b>` in
 * it reads as `<b>`. A text with nothing to show gives no message.
 */
export function chatHtmlOf(text: string): readonly string[] {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\t", tabSpaces)
    .split("\n")
    .map((line) => displayOutsideText(line, Number.POSITIVE_INFINITY));
  const shown = lines.join("\n").trim();
  return shown === "" ? [] : splitText(shown).map((piece) => escapeHtml(piece));
}

/** A status line of the agent's turn as Telegram HTML: in italics, quieter than its words. */
export function statusHtmlOf(line: string): string {
  return `<i>${escapeHtml(line)}</i>`;
}
