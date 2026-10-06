import { applyBps, type Bps } from "@binference/core";
import type { IntentKind } from "./intent-kind.js";
import type { QuoteTerms } from "./intent-status.js";

/** The agent's card limits (spec 2, `defaults.cards`), in milliseconds and basis points. */
export interface CardRules {
  /** How long a trade's card stays open: 60 s by default. */
  readonly tradeExpiryMs: number;
  /** How long a send, DeFi, bridge, rescue or identity card stays open: 10 min by default. */
  readonly otherExpiryMs: number;
  /** A tap on a quote older than this waits for a re-quote: 10 s by default. */
  readonly requoteAfterMs: number;
  /** A re-quote whose minimum out is worse by more than this opens a new card version: 50. */
  readonly requoteToleranceBps: Bps;
}

// Spec 6 names these kinds for the longer card. Every other kind gets the shorter one, since no
// answer is a no.
const longCardKinds: ReadonlySet<IntentKind> = new Set<IntentKind>([
  "send",
  "lend",
  "stake",
  "bridge",
  "rescue",
  "registerIdentity",
]);

/** When a card of this kind, opened at `openedAtMs`, expires. */
export function cardExpiresAt(kind: IntentKind, openedAtMs: number, rules: CardRules): number {
  return openedAtMs + (longCardKinds.has(kind) ? rules.otherExpiryMs : rules.tradeExpiryMs);
}

/** Whether a priced quote is older than the re-quote age at `nowMs`. An unpriced one never is. */
export function isQuoteStale(quote: QuoteTerms, nowMs: number, rules: CardRules): boolean {
  return quote.minOutBase !== undefined && nowMs - quote.quotedAtMs > rules.requoteAfterMs;
}

/**
 * Whether a re-quote's minimum out is worse than the card's by more than the tolerance, compared
 * exactly in base units. A re-quote that lost its price counts as worse, so a doubt asks again.
 */
export function isWorseThanTolerance(
  card: QuoteTerms,
  requote: QuoteTerms,
  rules: CardRules,
): boolean {
  if (card.minOutBase === undefined) {
    return false;
  }
  if (requote.minOutBase === undefined) {
    return true;
  }
  const allowedDropBase = applyBps(card.minOutBase, rules.requoteToleranceBps, "down");
  return card.minOutBase - requote.minOutBase > allowedDropBase;
}
