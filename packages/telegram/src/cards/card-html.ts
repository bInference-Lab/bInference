import { type Card, type CardClosing, type ReceiptFill, receiptLine } from "@binference/engine";
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
 * paper intent passes its paper fill, whose assets must be in `display.assets`.
 */
export function receiptHtml(
  closing: CardClosing,
  display: CardDisplay,
  paperFill?: ReceiptFill,
): string {
  return escapeHtml(cardLineText(receiptLine(closing, paperFill), display));
}
