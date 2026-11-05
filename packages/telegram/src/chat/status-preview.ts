import type { RichLine, RichMark } from "../format/rich-line.js";
import { type ChatHtml, chatHtmlOfLines, shownLinesOf } from "./chat-html.js";

/**
 * What a turn's status message shows (decision 0375): a fixed label, such as "Working", or in its
 * place the text the agent wrote before its latest tool, as one bold headline.
 */
export interface StatusView {
  /** The label in the owner's language, shown while there is no headline. */
  readonly label: string;
  /** The text written before the turn's latest tool, as one line. */
  readonly headline?: string;
}

const bold: RichMark = { kind: "bold" };

function bolded(line: RichLine): RichLine {
  const runs = line.runs.map((run) => ({
    text: run.text,
    marks: [bold, ...run.marks.filter((mark) => mark.kind !== "bold")],
  }));
  return { block: line.block, runs };
}

/**
 * A status message as Telegram HTML and as plain text: the headline, its Markdown drawn as an
 * answer's is (decision 0370), or the label, in bold.
 */
export function statusPreviewOf(view: StatusView): ChatHtml {
  const headline = view.headline === undefined ? [] : shownLinesOf(view.headline);
  const lines =
    headline.length === 0
      ? [{ block: { kind: "text" as const }, runs: [{ text: view.label, marks: [] }] }]
      : headline;
  return chatHtmlOfLines(lines.map(bolded));
}
