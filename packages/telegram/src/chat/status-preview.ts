import { richHtmlOf } from "../format/rich-html.js";
import type { RichLine } from "../format/rich-line.js";
import { splitRichLines } from "../split/split-rich-lines.js";
import { type ChatHtml, chatHtmlOfLines, chatMessageLength, shownLinesOf } from "./chat-html.js";

/**
 * One work line of a status message: a tool the turn runs, in the bot's own words and shown as
 * they are, or the text the agent wrote before it, its Markdown drawn.
 */
export interface WorkLine {
  readonly kind: "tool" | "narration";
  readonly text: string;
}

/** What a turn's status message shows. */
export interface StatusView {
  /** How long the agent has worked, as the owner reads it. */
  readonly headline: string;
  /** The work lines, oldest first. */
  readonly lines: readonly WorkLine[];
  /** The text the agent writes now, while it writes. */
  readonly draft?: string;
}

const textBlock = { kind: "text" } as const;
const blank: RichLine = { block: textBlock, runs: [] };
const cut: RichLine = { block: textBlock, runs: [{ text: "…", marks: [] }] };

function plainLine(text: string): RichLine {
  return { block: textBlock, runs: [{ text, marks: [] }] };
}

// The end of the draft that fits in `room` characters of HTML, after `…` when its start is cut.
function draftTail(draft: string, room: number): readonly RichLine[] {
  const lines = shownLinesOf(draft);
  if (lines.length === 0) {
    return [];
  }
  const fits = richHtmlOf(lines).length <= room;
  const pieces = splitRichLines(lines, fits ? room : room - richHtmlOf([cut]).length - 1);
  const last = pieces.at(-1) ?? [];
  return fits || last.length === 0 ? last : [cut, ...last];
}

/**
 * A status message as Telegram HTML and as plain text: the headline, the work lines, then the
 * draft drawn from its Markdown as an answer is (decision 0370). The whole stays within 4,000
 * characters: a draft too long shows its end after `…`.
 */
export function statusPreviewOf(view: StatusView): ChatHtml {
  const work = view.lines.flatMap((line) =>
    line.kind === "tool" ? [plainLine(line.text)] : shownLinesOf(line.text),
  );
  const head = [plainLine(view.headline), ...work];
  const room = chatMessageLength - richHtmlOf([...head, blank]).length - 1;
  const draft = view.draft === undefined ? [] : draftTail(view.draft, room);
  return chatHtmlOfLines(draft.length === 0 ? head : [...head, blank, ...draft]);
}
