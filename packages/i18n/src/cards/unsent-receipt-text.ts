import type { CardLineView } from "@binference/protocol";
import type { Formatter } from "../format/create-formatter.js";
import { messages } from "../messages.js";
import { cardLineText } from "./card-text.js";

/**
 * The receipt of a confirmed intent that ended before anything was sent or filled (spec 4, section
 * 3.5), as plain text in the owner's language, the words Telegram's copy of the card ends with:
 * `receipt.refused` with the reason its code names, or `receipt.unsent` for an intent that stored
 * no code, or one with a code this version has no words for.
 */
export function unsentReceiptText(formatter: Formatter, reason: string | undefined): string {
  const key = `reason.${reason ?? ""}`;
  const line: CardLineView = Object.hasOwn(messages.en, key)
    ? { key: "receipt.refused", values: { reason: { type: "line", line: { key, values: {} } } } }
    : { key: "receipt.unsent", values: {} };
  return cardLineText(line, { formatter, assets: {} });
}
