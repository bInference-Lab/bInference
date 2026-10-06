import { err, ok, type Result } from "@binference/core";
import { cardExpiresAt, isQuoteStale, isWorseThanTolerance } from "./card-rules.js";
import type { CardTerms, IntentStatus, QuoteTerms } from "./intent-status.js";
import type { GuardInput, IntentChange, TransitionProblem } from "./transition-guard.js";

/** The card the owner sees and the quote it shows. */
interface OpenCard {
  readonly card: CardTerms;
  readonly quote: QuoteTerms;
}

// A tap counts only on the current card version, before that version expires.
function tappedCard(
  status: IntentStatus,
  cardVersion: number,
  nowMs: number,
): Result<OpenCard, TransitionProblem> {
  const { card, quote } = status;
  if (card === undefined || quote === undefined || card.version !== cardVersion) {
    return err("card_changed");
  }
  return nowMs < card.expiresAtMs ? ok({ card, quote }) : err("expired");
}

/** `awaiting_confirmation` to `confirmed` on a tap: the current card version, its quote fresh. */
export function confirmTap({
  status,
  trigger,
  nowMs,
}: GuardInput<"confirm_tapped">): Result<IntentChange, TransitionProblem> {
  const open = tappedCard(status, trigger.cardVersion, nowMs);
  if (!open.ok) {
    return open;
  }
  return isQuoteStale(open.value.quote, nowMs, trigger.cards) ? err("quote_stale") : ok({});
}

type RequoteInput = GuardInput<"confirm_requoted">;

function requotedCard({
  status,
  trigger,
  nowMs,
}: RequoteInput): Result<OpenCard, TransitionProblem> {
  const open = tappedCard(status, trigger.cardVersion, nowMs);
  if (!open.ok) {
    return open;
  }
  return isQuoteStale(trigger.requote, nowMs, trigger.cards) ? err("quote_stale") : open;
}

/**
 * `awaiting_confirmation` to `confirmed` after a re-quote: the new minimum out is within the
 * tolerance of the card's, so the tap counts on the new quote.
 */
export function confirmRequote(input: RequoteInput): Result<IntentChange, TransitionProblem> {
  const open = requotedCard(input);
  if (!open.ok) {
    return open;
  }
  const { requote, cards } = input.trigger;
  return isWorseThanTolerance(open.value.quote, requote, cards)
    ? err("quote_worse")
    : ok({ quote: requote });
}

/**
 * `awaiting_confirmation` to itself after a re-quote: the new minimum out is worse than the card's
 * by more than the tolerance, so card version n+1 opens with the new quote.
 */
export function reopenCard(input: RequoteInput): Result<IntentChange, TransitionProblem> {
  const open = requotedCard(input);
  if (!open.ok) {
    return open;
  }
  const { status, trigger, nowMs } = input;
  if (!isWorseThanTolerance(open.value.quote, trigger.requote, trigger.cards)) {
    return err("quote_held");
  }
  const card: CardTerms = {
    version: open.value.card.version + 1,
    openedAtMs: nowMs,
    expiresAtMs: cardExpiresAt(status.kind, nowMs, trigger.cards),
  };
  return ok({ quote: trigger.requote, card });
}

/** `awaiting_confirmation` to `expired`: the card's time is up, or the intent has no card. */
export function expireCard({
  status,
  nowMs,
}: GuardInput<"card_timer_fired">): Result<IntentChange, TransitionProblem> {
  const { card } = status;
  return card === undefined || nowMs >= card.expiresAtMs ? ok({}) : err("not_expired");
}
