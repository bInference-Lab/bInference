import { err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { CardAnswer } from "../confirmations/card-answer.js";
import type { AnswerOutcome, Confirmations } from "../confirmations/create-confirmations.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { QuoteFailure, SimulationFailure } from "../intents/intent-reason.js";
import type { PaperFills } from "../paper/paper-fills.js";

/** An answer's outcome, with the intent as it stands after it. */
export interface AnsweredCard {
  readonly outcome: AnswerOutcome;
  readonly intent: IntentSnapshot;
}

/**
 * Applies the owner's answer from any surface: Telegram's tap, the console's or the CLI's call.
 * A confirmed paper intent then fills at its confirmed quote.
 */
export type AnswerCard = (
  answer: CardAnswer,
  options: { readonly signal: AbortSignal },
) => Promise<Result<AnsweredCard, "not_found">>;

/** What answers are applied through. */
export interface AnswerCardOptions {
  readonly confirmations: Confirmations;
  readonly stored: StoredIntents;
  readonly paper: PaperFills;
}

/** Creates the {@link AnswerCard} step over the confirmations and paper mode. */
export function createAnswerCard(options: AnswerCardOptions): AnswerCard {
  return async (answer, { signal }) => {
    const answered = await options.confirmations.answer(answer, { signal });
    const snapshot = answered.ok
      ? await options.stored.snapshot(answer.intent, { signal })
      : undefined;
    if (!answered.ok || snapshot === undefined) {
      return err("not_found");
    }
    const outcome: AnswerOutcome = answered.value;
    return ok({ outcome, intent: await options.paper.fillAtQuote(snapshot, { signal }) });
  };
}

// An answer that confirmed, cancelled, or opened the next card version took effect: no error.
const verdictErrors: Readonly<
  Record<Exclude<AnswerOutcome["verdict"], "requote_failed">, ProtocolErrorCode | undefined>
> = {
  confirmed: undefined,
  denied: undefined,
  reopened: undefined,
  expired: "intent.expired",
  closed: "intent.wrong_state",
  card_changed: "intent.card_changed",
};

const requoteErrors: Readonly<Record<QuoteFailure | SimulationFailure, ProtocolErrorCode>> = {
  no_route: "quote.no_route",
  venue_down: "quote.venue_down",
  decode_mismatch: "quote.no_route",
  price_impact: "quote.no_route",
  simulation_reverted: "chain.simulation_failed",
  effects_differ: "chain.simulation_failed",
};

/**
 * The protocol error an answer's outcome is, or `undefined` when the answer took effect: it
 * confirmed, cancelled, or opened the next card version after a worse re-quote.
 */
export function answerError(outcome: AnswerOutcome): ProtocolErrorCode | undefined {
  return outcome.verdict === "requote_failed"
    ? requoteErrors[outcome.reason]
    : verdictErrors[outcome.verdict];
}
