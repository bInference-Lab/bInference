import { err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { CardAnswer } from "../confirmations/card-answer.js";
import type { AnswerOutcome, Confirmations } from "../confirmations/create-confirmations.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { QuoteFailure, SimulationFailure } from "../intents/intent-reason.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";

/**
 * A Confirm of a live intent while the engine is locked: nothing could sign it, so the answer is
 * not taken and the card stays open for the owner to confirm once unlocked.
 */
export interface LockedOutcome {
  readonly verdict: "locked";
}

/** An answer's outcome, with the intent as it stands after it. */
export interface AnsweredCard {
  readonly outcome: AnswerOutcome | LockedOutcome;
  readonly intent: IntentSnapshot;
}

/**
 * Applies the owner's answer from any surface: Telegram's tap, the console's or the CLI's call.
 * A confirmed intent then goes on to the execute step: a paper intent fills at its confirmed
 * quote, and the executor takes a live one. While the engine is locked, a Confirm of a live
 * intent waiting for its answer is refused as `locked` and changes nothing.
 */
export type AnswerCard = (
  answer: CardAnswer,
  options: { readonly signal: AbortSignal },
) => Promise<Result<AnsweredCard, "not_found">>;

/** What answers are applied through. */
export interface AnswerCardOptions {
  readonly confirmations: Confirmations;
  readonly stored: StoredIntents;
  readonly execute: ExecuteConfirmed;
  /** Whether the engine is locked, so a live intent cannot be signed. */
  readonly isLocked: () => boolean;
}

// The lock is read before the answer is stored: a Confirm that could not be signed never lands.
async function lockedAnswer(
  options: AnswerCardOptions,
  answer: CardAnswer,
  signal: AbortSignal,
): Promise<AnsweredCard | undefined> {
  if (answer.decision !== "confirm" || !options.isLocked()) {
    return undefined;
  }
  const snapshot = await options.stored.snapshot(answer.intent, { signal });
  const isWaitingLive =
    snapshot?.record.state === "awaiting_confirmation" && !snapshot.record.isPaper;
  return isWaitingLive ? { outcome: { verdict: "locked" }, intent: snapshot } : undefined;
}

/** Creates the {@link AnswerCard} step over the confirmations and the execute step. */
export function createAnswerCard(options: AnswerCardOptions): AnswerCard {
  return async (answer, { signal }) => {
    const locked = await lockedAnswer(options, answer, signal);
    if (locked !== undefined) {
      return ok(locked);
    }
    const answered = await options.confirmations.answer(answer, { signal });
    const snapshot = answered.ok
      ? await options.stored.snapshot(answer.intent, { signal })
      : undefined;
    if (!answered.ok || snapshot === undefined) {
      return err("not_found");
    }
    const outcome: AnswerOutcome = answered.value;
    return ok({ outcome, intent: await options.execute(snapshot, { signal }) });
  };
}

// An answer that confirmed, cancelled, or opened the next card version took effect: no error.
const verdictErrors: Readonly<
  Record<
    Exclude<AnsweredCard["outcome"]["verdict"], "requote_failed">,
    ProtocolErrorCode | undefined
  >
> = {
  confirmed: undefined,
  denied: undefined,
  reopened: undefined,
  expired: "intent.expired",
  closed: "intent.wrong_state",
  card_changed: "intent.card_changed",
  locked: "engine.locked",
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
 * confirmed, cancelled, or opened the next card version after a worse re-quote. A Confirm the
 * locked engine refused is `engine.locked`, which the owner retries once unlocked.
 */
export function answerError(outcome: AnsweredCard["outcome"]): ProtocolErrorCode | undefined {
  return outcome.verdict === "requote_failed"
    ? requoteErrors[outcome.reason]
    : verdictErrors[outcome.verdict];
}
