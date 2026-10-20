import type { LaunchDraftShowing } from "@binference/engine/surfaces";
import { type CardDisplay, cardLineText } from "@binference/i18n";
import { escapeHtml } from "../format/escape-html.js";
import type { ButtonRows } from "../ingress/bot-calls.js";
import { launchDraftCallbackData } from "./launch-draft-callback.schema.js";

/** The words of a launch draft's message, in the owner's language. */
export type DraftWords = (key: string, values?: Readonly<Record<string, string>>) => string;

/**
 * A launch draft as Telegram HTML (spec 4, section 8.5): a header naming the agent and saying
 * nothing is public before Start, every line the launch's card will show from the draft, each
 * value from the draft drawn as outside text, and when the draft ends. The whole is escaped.
 */
export function launchDraftHtml(
  showing: LaunchDraftShowing,
  view: { readonly words: DraftWords; readonly display: CardDisplay; readonly until: string },
): string {
  const { words, display } = view;
  const header = `<b>${escapeHtml(words("telegram.draft.header", { agent: showing.agentName }))}</b>`;
  const lines = showing.lines.map((line) => escapeHtml(cardLineText(line, display)));
  const footer = `<i>${escapeHtml(words("telegram.draft.footer", { time: view.until }))}</i>`;
  return [header, ...lines, footer].join("\n");
}

/** The draft's buttons on one row: Start launch, then Drop, each carrying `bnf1:s:<y|n>:<ref>`. */
export function launchDraftButtons(ref: string, words: DraftWords): ButtonRows {
  return [
    [
      { text: words("telegram.draft.start"), data: launchDraftCallbackData({ start: true, ref }) },
      { text: words("telegram.draft.drop"), data: launchDraftCallbackData({ start: false, ref }) },
    ],
  ];
}
