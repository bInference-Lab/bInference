import type { CardLineView, IntentView } from "@binference/protocol";
import type { Formatter } from "../format/create-formatter.js";
import { messages } from "../messages.js";
import { cardLineText } from "./card-text.js";

/** What a reason's words may name: a send's name, a bridge's chain and the intent's wallet. */
export interface ReasonNames {
  readonly name?: string | undefined;
  readonly chain?: string | undefined;
  readonly wallet?: string | undefined;
}

/** What an intent's view gives a reason's words to name. */
export function reasonNamesOf(
  view: Pick<IntentView, "wallet" | "outcome" | "resolvedName">,
): ReasonNames {
  return { name: view.resolvedName?.name, chain: view.outcome?.chain, wallet: view.wallet };
}

/**
 * The receipt of a confirmed intent that ended before anything was sent or filled (spec 4, section
 * 3.5), as plain text in the owner's language, the words Telegram's copy of the card ends with:
 * `receipt.refused` with the reason its code names, or `receipt.unsent` for an intent that stored
 * no code, or one with a code this version has no words for. The words of a reason name what the
 * view gives: a send by name's name, a bridge's destination chain, the intent's wallet.
 */
export function unsentReceiptText(
  formatter: Formatter,
  reason: string | undefined,
  named: ReasonNames = {},
): string {
  const key = `reason.${reason ?? ""}`;
  const values: Record<string, { readonly type: "text"; readonly text: string }> = {};
  for (const [field, text] of Object.entries(named)) {
    if (typeof text === "string") {
      values[field] = { type: "text", text };
    }
  }
  const line: CardLineView = Object.hasOwn(messages.en, key)
    ? { key: "receipt.refused", values: { reason: { type: "line", line: { key, values } } } }
    : { key: "receipt.unsent", values: {} };
  return cardLineText(line, { formatter, assets: {} });
}
