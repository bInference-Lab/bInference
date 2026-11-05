import { displayOutsideText } from "@binference/i18n";
import type { RichLine, RichMark } from "../format/rich-line.js";
import { type ChatHtml, chatHtmlOfLines, shownLinesOf } from "./chat-html.js";

/**
 * What a turn's status message shows (decision 0375): a fixed label, such as "Working", or in its
 * place the text the agent wrote before its latest tool, as one bold headline; under the label,
 * the model's reasoning as one line while the owner has it streamed (decision 0377).
 */
export interface StatusView {
  /** The label in the owner's language, shown while there is no headline. */
  readonly label: string;
  /** The text written before the turn's latest tool, as one line. */
  readonly headline?: string;
  /** The reasoning line, words and all, such as "Reasoning: …"; shown only under the label. */
  readonly reasoning?: string;
}

const textBlock = { kind: "text" } as const;

function marked(line: RichLine, mark: RichMark): RichLine {
  const runs = line.runs.map((run) => ({
    text: run.text,
    marks: [mark, ...run.marks.filter((given) => given.kind !== mark.kind)],
  }));
  return { block: line.block, runs };
}

function plainLine(text: string, mark: RichMark): RichLine {
  return {
    block: textBlock,
    runs: [{ text: displayOutsideText(text, Number.POSITIVE_INFINITY), marks: [mark] }],
  };
}

/**
 * A status message as Telegram HTML and as plain text: the headline, its Markdown drawn as an
 * answer's is (decision 0370), in bold; or the label in bold and the reasoning line in italics.
 */
export function statusPreviewOf(view: StatusView): ChatHtml {
  const headline = view.headline === undefined ? [] : shownLinesOf(view.headline);
  if (headline.length > 0) {
    return chatHtmlOfLines(headline.map((line) => marked(line, { kind: "bold" })));
  }
  const reasoning =
    view.reasoning === undefined ? [] : [plainLine(view.reasoning, { kind: "italic" })];
  return chatHtmlOfLines([plainLine(view.label, { kind: "bold" }), ...reasoning]);
}
