import { assetRefParts, type ChainRegistry } from "@binference/chain";
import type { CardFacts, CardWarnings } from "../confirmations/draw-card.js";
import type { WebhookRuleAction } from "../confirmations/webhook-rule-card-lines.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { WebhookRuleQuote } from "../webhooks/webhook-rule-quote.js";
import type { CardSource } from "./card-facts-of.js";

/**
 * A webhook rule's action, as its card and its receipt draw it: its terms with every default
 * filled, a buy's spend the chain's coin when it names none. `undefined` for a token on a chain
 * the registry no longer holds, which no card can draw.
 */
export function webhookRuleActionOf(
  quote: WebhookRuleQuote,
  chains: ChainRegistry,
): WebhookRuleAction | undefined {
  const { request } = quote;
  const chain = chains.get(assetRefParts(request.token).chain);
  if (!chain.ok) {
    return undefined;
  }
  return {
    name: request.name,
    request,
    spend: request.spend ?? nativeAssetOf(chain.value),
    ratePerMinute: quote.ratePerMinute,
    ...(quote.maxFills === undefined ? {} : { maxFills: quote.maxFills }),
    expiresAtMs: quote.expiresAtMs,
    isPaper: quote.isPaper,
  };
}

/**
 * A webhook rule's card (spec 4, section 3.9; decision 0299): its action line and the lines under
 * it, its worst price when it names one, the launch or bridge wallet that holds it (decision
 * 0217), and the warnings every card carries. It never says why
 * auto mode asks: a rule's card always waits for the owner's tap.
 */
export function webhookRuleCardFacts(
  quote: WebhookRuleQuote,
  source: CardSource,
  warnings: CardWarnings,
): CardFacts | undefined {
  const { record, card, settings, chains, roleWallet } = source;
  const action = webhookRuleActionOf(quote, chains);
  if (action === undefined) {
    return undefined;
  }
  const { worstPrice } = quote.request;
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: { kind: "webhookRule", ...action },
    warnings: { ...warnings, ...(worstPrice === undefined ? {} : { worstPrice }) },
    ...(roleWallet === undefined ? {} : { roleWallet }),
  };
}
