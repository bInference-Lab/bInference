import { displayOutsideText } from "@binference/i18n";
import type { RichLine, RichMark } from "../format/rich-line.js";
import { splitRichLines } from "../split/split-rich-lines.js";
import { type ChatHtml, chatHtmlOfLines, chatMessageLength, shownLinesOf } from "./chat-html.js";

const italic: RichMark = { kind: "italic" };
const bold: RichMark = { kind: "bold" };
const textBlock = { kind: "text" } as const;

function italicized(line: RichLine): RichLine {
  const runs = line.runs.map((run) => ({
    text: run.text,
    marks: [italic, ...run.marks.filter((mark) => mark.kind !== "italic")],
  }));
  return { block: line.block, runs };
}

/**
 * The model's reasoning as Telegram messages (decision 0377): a bold title, such as "Reasoning",
 * then the reasoning in italics, its Markdown drawn as an answer's is (decision 0370), split into
 * messages of at most 4,000 characters. Reasoning with nothing to show gives no message.
 */
export function reasoningHtmlOf(title: string, text: string): readonly ChatHtml[] {
  const body = shownLinesOf(text).map(italicized);
  if (body.length === 0) {
    return [];
  }
  const head: RichLine = {
    block: textBlock,
    runs: [{ text: displayOutsideText(title, Number.POSITIVE_INFINITY), marks: [bold] }],
  };
  return splitRichLines([head, ...body], chatMessageLength).map(chatHtmlOfLines);
}
