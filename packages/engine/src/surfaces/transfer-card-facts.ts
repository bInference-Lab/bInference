import type { JsonValue } from "@binference/core";
import type { CardAction } from "../confirmations/card-action.js";
import type { CardFacts, CardWarnings } from "../confirmations/draw-card.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentKind } from "../intents/intent-kind.js";
import { revokeQuoteDocument } from "../intents/revoke-quote.js";
import { type SendQuote, sendQuoteDocument } from "../intents/send-quote.js";
import type { CardSource } from "./card-facts-of.js";

// A send's action, with the name its card shows beside the address when it was sent by name.
function sendAction(quote: SendQuote): CardAction<"send"> {
  const { amount, recipient, name } = quote;
  if (name === undefined) {
    return { kind: "send", amount, recipient };
  }
  const { smartAccount } = name;
  const shown = { name: name.name, resolvedAtMs: name.resolvedAtMs };
  return {
    kind: "send",
    amount,
    recipient,
    name: smartAccount === undefined ? shown : { ...shown, smartAccount },
  };
}

// The warning a send by name's reverse record gives when it names another name; none otherwise.
function reverseOf(quote: SendQuote): Pick<CardWarnings, "reverseDiffers"> {
  const other = quote.name?.reverseOther;
  return quote.name === undefined || other === undefined
    ? {}
    : { reverseDiffers: { name: quote.name.name, other } };
}

// A send's action and its reverse record's warning, or a revoke's action.
function actionOf(
  kind: IntentKind,
  quote: JsonValue,
): { readonly action: CardAction; readonly reverse: Pick<CardWarnings, "reverseDiffers"> } {
  if (kind === "send") {
    const sent = sendQuoteDocument.decode(quote);
    return { action: sendAction(sent), reverse: reverseOf(sent) };
  }
  const { token, spender } = revokeQuoteDocument.decode(quote);
  return { action: { kind: "revokeApproval", token, spender }, reverse: {} };
}

/**
 * The facts of a send's or an approval revoke's card (spec 4, sections 3.3 and 3.9), from its
 * quote, which the card's terms hash covers: a send's amount and the address it pays, with the
 * name it was resolved from, its read and a reverse record that names another name; a revoke's
 * spender and token; then the wallet of a role it runs from and the agent's reason.
 */
export function transferCardFacts(
  quote: JsonValue,
  source: CardSource,
  warnings: CardWarnings,
): CardFacts {
  const { record, card, settings, roleWallet } = source;
  const { action, reverse } = actionOf(record.kind, quote);
  const terms = {
    version: card.version,
    openedAtMs: card.openedAtMs,
    expiresAtMs: card.expiresAtMs,
  };
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: terms,
    action,
    ...(roleWallet === undefined ? {} : { roleWallet }),
    warnings: { ...warnings, ...reverse },
    reason: requestDocument.decode(record.request).reason,
  };
}
