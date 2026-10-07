import type { CardRules } from "../intents/card-rules.js";
import type { LimitsValues } from "./limits-record.js";

const msPerSecond = 1_000;

/** The agent's card rules, read from its limits in milliseconds. */
export function cardRulesOf(limits: LimitsValues): CardRules {
  return {
    tradeExpiryMs: limits.cardTradeExpiryS * msPerSecond,
    otherExpiryMs: limits.cardOtherExpiryS * msPerSecond,
    requoteAfterMs: limits.requoteAfterS * msPerSecond,
    requoteToleranceBps: limits.requoteToleranceBps,
  };
}
