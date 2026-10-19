import { err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { CardAnswer } from "../confirmations/card-answer.js";
import type { AnswerOutcome, Confirmations } from "../confirmations/create-confirmations.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentKind } from "../intents/intent-kind.js";
import type { QuoteFailure, SimulationFailure } from "../intents/intent-reason.js";
import type { ExecuteConfirmed } from "../money-path/execute-confirmed.js";

/**
 * A Confirm of a live intent while the engine is locked: nothing could sign it, so the answer is
 * not taken and the card stays open for the owner to confirm once unlocked.
 */
export interface LockedOutcome {
  readonly verdict: "locked";
}

/**
 * A Confirm that would pass the agent's rolling 24-hour cap with the intents confirmed before it
 * (decision 0136): the answer is not taken, and the card stays open until it expires or the owner
 * cancels it.
 */
interface OverCapOutcome {
  readonly verdict: "over_cap";
}

/** An answer's outcome, with the intent as it stands after it. */
export interface AnsweredCard {
  readonly outcome: AnswerOutcome | LockedOutcome | OverCapOutcome;
  readonly intent: IntentSnapshot;
}

/**
 * Applies the owner's answer from any surface: Telegram's tap, the console's or the CLI's call.
 * A confirmed intent then goes on to the execute step: a paper intent fills at its confirmed
 * quote, and the executor takes a live one. While the engine is locked, a Confirm of a live
 * intent waiting for its answer is refused as `locked` and changes nothing; an unfreeze's and an
 * auto order's are taken.
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
  /** The rolling cap each confirmation is checked against, one agent's at a time. */
  readonly gate: CapGate;
}

// The lock is read before the answer is stored: a Confirm that could not be signed never lands. An
// unfreeze and an auto order's card sign nothing, so a locked engine takes their tap (decisions
// 0128 and 0189).
const unsignedKinds: ReadonlySet<IntentKind> = new Set<IntentKind>(["unfreeze", "autoOrder"]);

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
    snapshot?.record.state === "awaiting_confirmation" &&
    !snapshot.record.isPaper &&
    !unsignedKinds.has(snapshot.record.kind);
  return isWaitingLive ? { outcome: { verdict: "locked" }, intent: snapshot } : undefined;
}

// A Confirm runs in the agent's turn at the gate, so the outflows it is checked against are the
// ones every earlier confirmation of the agent left.
async function answerInTurn(
  options: AnswerCardOptions,
  answer: CardAnswer,
  signal: AbortSignal,
): Promise<AnsweredCard | undefined> {
  const before = await options.stored.snapshot(answer.intent, { signal });
  const answerNow = async (): Promise<AnsweredCard | undefined> => {
    const now = await options.stored.snapshot(answer.intent, { signal });
    const isWaiting = now?.record.state === "awaiting_confirmation";
    if (answer.decision === "confirm" && isWaiting && !(await options.gate.fits(now, { signal }))) {
      return { outcome: { verdict: "over_cap" }, intent: now };
    }
    const answered = await options.confirmations.answer(answer, { signal });
    const after = answered.ok
      ? await options.stored.snapshot(answer.intent, { signal })
      : undefined;
    return answered.ok && after !== undefined
      ? { outcome: answered.value, intent: after }
      : undefined;
  };
  return before === undefined || answer.decision !== "confirm"
    ? answerNow()
    : options.gate.serially(before.record.agentId, answerNow);
}

/** Creates the {@link AnswerCard} step over the confirmations and the execute step. */
export function createAnswerCard(options: AnswerCardOptions): AnswerCard {
  return async (answer, { signal }) => {
    const locked = await lockedAnswer(options, answer, signal);
    if (locked !== undefined) {
      return ok(locked);
    }
    const answered = await answerInTurn(options, answer, signal);
    if (answered === undefined) {
      return err("not_found");
    }
    const { outcome, intent } = answered;
    return outcome.verdict === "over_cap"
      ? ok(answered)
      : ok({ outcome, intent: await options.execute(intent, { signal }) });
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
  over_cap: "limit.daily_cap",
};

const requoteErrors: Readonly<Record<QuoteFailure | SimulationFailure, ProtocolErrorCode>> = {
  no_route: "quote.no_route",
  venue_down: "quote.venue_down",
  decode_mismatch: "quote.no_route",
  price_impact: "quote.no_route",
  nothing_to_sell: "quote.no_route",
  balance_unread: "chain.rpc_down",
  needs_launch_wallet: "limit.needs_launch_wallet",
  launch_unread: "quote.venue_down",
  // A launch reads its picture once, before its pin, and is never quoted again at a tap.
  image_unreadable: "quote.no_route",
  upload_lost: "quote.no_route",
  simulation_reverted: "chain.simulation_failed",
  effects_differ: "chain.simulation_failed",
};

/**
 * The protocol error an answer's outcome is, or `undefined` when the answer took effect: it
 * confirmed, cancelled, or opened the next card version after a worse re-quote. A Confirm the
 * locked engine refused is `engine.locked`, which the owner retries once unlocked; one past the
 * rolling 24-hour cap is `limit.daily_cap`.
 */
export function answerError(outcome: AnsweredCard["outcome"]): ProtocolErrorCode | undefined {
  return outcome.verdict === "requote_failed"
    ? requoteErrors[outcome.reason]
    : verdictErrors[outcome.verdict];
}
