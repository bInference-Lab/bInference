import type { JsonValue } from "@binference/core";
import type { CardAction } from "../confirmations/card-action.js";
import type { CardFacts, CardWarnings } from "../confirmations/draw-card.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentKind } from "../intents/intent-kind.js";
import { revokeQuoteDocument } from "../intents/revoke-quote.js";
import { type SendQuote, sendQuoteDocument } from "../intents/send-quote.js";
import type { CardSource } from "./card-facts-of.js";

/** The warnings a send's or a revoke's quote gives beside every card's own. */
type TransferWarnings = Partial<Pick<CardWarnings, "reverseDiffers" | "isNewAddress">>;

// A send's action, with who it pays, and the name its card shows beside the address when it was
// sent by name.
function sendAction(quote: SendQuote): CardAction<"send"> {
  const { amount, recipient, name, label, isRescue } = quote;
  const payee = {
    ...(label === undefined ? {} : { label }),
    ...(isRescue === undefined ? {} : { isRescue }),
  };
  if (name === undefined) {
    return { kind: "send", amount, recipient, payee };
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

// The warnings a send's quote gives: an address the agent never sent to, and a send by name whose
// reverse record names another name.
function sendWarnings(quote: SendQuote): TransferWarnings {
  const other = quote.name?.reverseOther;
  const isNewAddress = quote.isNewRecipient === true;
  return quote.name === undefined || other === undefined
    ? { isNewAddress }
    : { isNewAddress, reverseDiffers: { name: quote.name.name, other } };
}

// A send's action and its warnings, or a revoke's action.
function actionOf(
  kind: IntentKind,
  quote: JsonValue,
): { readonly action: CardAction; readonly reverse: TransferWarnings } {
  if (kind === "send") {
    const sent = sendQuoteDocument.decode(quote);
    return { action: sendAction(sent), reverse: sendWarnings(sent) };
  }
  const { token, spender, spenderName } = revokeQuoteDocument.decode(quote);
  const named = spenderName === undefined ? {} : { spenderName };
  return { action: { kind: "revokeApproval", token, spender, ...named }, reverse: {} };
}

/**
 * The facts of a send's or an approval revoke's card (spec 4, sections 3.3 and 3.9), from its
 * quote, which the card's terms hash covers: a send's amount and the address it pays, labeled as
 * the address book or the rescue address names it, with the name it was resolved from, its read,
 * a reverse record that names another name and an address the agent never sent to; a revoke's
 * spender by its registry name and its token; then the wallet of a role it runs from and the
 * agent's reason.
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
