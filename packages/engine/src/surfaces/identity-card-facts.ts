import type { CardFacts, CardWarnings } from "../confirmations/draw-card.js";
import type { IdentityQuote } from "../intents/identity-quote.js";
import type { CardSource } from "./card-facts-of.js";

/**
 * The facts of an identity registration's card (spec 4, section 3.9; decision 0334), from its
 * quote, which the card's terms hash covers: the agent it registers, every field its registration
 * file publishes, and that the record is public for good. The owner asked for it, so no agent's
 * reason shows.
 */
export function identityCardFacts(
  quote: IdentityQuote,
  source: CardSource,
  warnings: CardWarnings,
): CardFacts {
  const { record, card, settings } = source;
  const { name, description, wallet, version } = quote;
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: {
      kind: "registerIdentity",
      agent: name,
      details: { name, description, wallet, version },
    },
    warnings,
  };
}
