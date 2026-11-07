import type { JsonValue } from "@binference/core";
import {
  configChangeQuoteDocument,
  configChangeRequestDocument,
} from "../config-changes/config-change-quote.js";
import type { CardFacts, CardWarnings } from "../confirmations/draw-card.js";
import type { CardSource } from "./card-facts-of.js";

/**
 * A config change's card (decision 0393): each key it changes, before and after, whether a
 * restart applies it, the proposer's reason, and the outside-content warning when the agent
 * proposed it after reading outside content.
 */
export function configChangeCardFacts(
  quote: JsonValue,
  source: CardSource,
  warnings: CardWarnings,
): CardFacts {
  const { changes, restartNeeded } = configChangeQuoteDocument.decode(quote);
  const { record, card, settings } = source;
  const { reason } = configChangeRequestDocument.decode(record.request);
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: { kind: "configChange", changes, restartNeeded },
    warnings,
    ...(reason === undefined ? {} : { reason }),
  };
}
