import type { LaunchDraftShowing } from "@binference/engine/surfaces";
import { type CardDisplay, cardLineText } from "@binference/i18n";
import { escapeHtml } from "../format/escape-html.js";
import type { ButtonRows } from "../ingress/bot-calls.js";
import { splitText } from "../split/split-text.js";
import { launchDraftCallbackData } from "./launch-draft-callback.schema.js";

/** The words of a launch draft's message, in the owner's language. */
export type DraftWords = (key: string, values?: Readonly<Record<string, string>>) => string;

/**
 * A launch draft as Telegram HTML messages (spec 4, section 8.5): a header naming the agent and
 * saying nothing is public before Start, every line the launch's card will show from the draft,
 * each value from the draft drawn as outside text, the notes, and when the draft ends. The lines
 * are split into messages of at most 4,096 characters as a reader sees them, and each is escaped
 * whole; the buttons go on the last.
 */
export function launchDraftMessages(
  showing: LaunchDraftShowing,
  view: {
    readonly words: DraftWords;
    readonly display: CardDisplay;
    readonly until: string;
    readonly notes: readonly string[];
  },
): readonly string[] {
  const { words, display } = view;
  const header = words("telegram.draft.header", { agent: showing.agentName });
  const lines = showing.lines.map((line) => cardLineText(line, display));
  const footer = words("telegram.draft.footer", { time: view.until });
  const pieces = splitText([header, ...lines, ...view.notes, footer].join("\n"));
  const last = pieces.length - 1;
  return pieces.map((piece, at) => {
    const escaped = piece.split("\n").map((line) => escapeHtml(line));
    const end = escaped.length - 1;
    return escaped
      .map((line, index) => (at === 0 && index === 0 ? `<b>${line}</b>` : line))
      .map((line, index) => (at === last && index === end ? `<i>${line}</i>` : line))
      .join("\n");
  });
}

/**
 * The draft's buttons on one row: Start launch, then Drop, each carrying `bnf1:s:<y|n>:<ref>`;
 * Drop alone when the draft cannot start, as when its picture could not be shown.
 */
export function launchDraftButtons(
  ref: string,
  words: DraftWords,
  draft: { readonly canStart: boolean },
): ButtonRows {
  const start = {
    text: words("telegram.draft.start"),
    data: launchDraftCallbackData({ start: true, ref }),
  };
  const drop = {
    text: words("telegram.draft.drop"),
    data: launchDraftCallbackData({ start: false, ref }),
  };
  return [draft.canStart ? [start, drop] : [drop]];
}
