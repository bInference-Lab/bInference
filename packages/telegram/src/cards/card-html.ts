import { type Card, type CardClosing, receiptLine } from "@binference/engine";
import type { ReceiptAfter } from "@binference/engine/surfaces";
import { type CardDisplay, cardLineText } from "@binference/i18n";
import { escapeHtml } from "../format/escape-html.js";

export type { CardDisplay } from "@binference/i18n";

/**
 * A card version as Telegram HTML, one line per card line (spec 4, section 3). Each line is
 * filled in as plain text, then escaped whole: a token named `<b>` shows as `<b>`, never as bold.
 * Throws `engine.card_asset_unknown` when the card names an asset `display.assets` lacks.
 */
export function cardHtml(card: Card, display: CardDisplay): string {
  return card.lines.map((line) => escapeHtml(cardLineText(line, display))).join("\n");
}

/**
 * The receipt a card becomes when it closes (spec 4, section 3.5), as Telegram HTML. A confirmed
 * intent passes what followed, a paper fill or how the live intent ended on chain, whose assets
 * must be in `display.assets`.
 */
export function receiptHtml(
  closing: CardClosing,
  display: CardDisplay,
  after?: ReceiptAfter,
): string {
  return escapeHtml(cardLineText(receiptLine(closing, after), display));
}
