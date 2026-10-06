import { BinferenceError, type Clock, err, type Id, ok, type Result } from "@binference/core";
import type { QuoteFailure, SimulationFailure } from "../intents/intent-reason.js";
import type { CardTerms } from "../intents/intent-status.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import {
  createIntentStateMachine,
  type IntentStateMachine,
  type IntentStep,
} from "../intents/state-machine.js";
import type { TransitionProblem } from "../intents/transition-guard.js";
import type { ConfirmationStore, QuoteSource, Simulator } from "../ports.js";
import type { Answerer, CardAnswer } from "./card-answer.js";
import type { IntentWrite, Requote, StoredIntent } from "./stored-intent.js";

/**
 * What became of an answer. `confirmed` and `denied`: this answer closed the card. `reopened`: a
 * re-quote came back worse than the tolerance, so card version n+1 waits for a new answer.
 * `expired`: the card's time was up, so it closed as expired. `closed`: another answer, the timer
 * or a cancel came first, and nothing changed. `card_changed`: a Confirm on an older version; the
 * current one stays open. `requote_failed`: the re-quote or its simulation failed, or came back
 * too late to count as fresh; the card stays open and nothing is confirmed.
 */
export type AnswerOutcome =
  | {
      readonly verdict: "confirmed" | "denied" | "reopened" | "expired" | "closed" | "card_changed";
    }
  | {
      readonly verdict: "requote_failed";
      readonly reason: QuoteFailure | SimulationFailure;
    };

/** An answer's outcome, with the intent as it stands after it. */
export type AnswerResult = AnswerOutcome & { readonly intent: StoredIntent };

/**
 * What the card timer did. `expired`: the card closed as expired. `open`: its time is not up yet.
 * `closed`: an answer or a cancel came first.
 */
export interface ExpiryResult {
  readonly verdict: "expired" | "open" | "closed";
  readonly intent: StoredIntent;
}

/**
 * The confirmation step of the money path (ARCHITECTURE.md section 7). It turns the owner's
 * answers and the card timer into triggers; the state machine decides each move, and the store
 * keeps only the first one that lands. Every later answer sees the card closed.
 */
export interface Confirmations {
  /**
   * Applies the owner's answer to a card. A Confirm on a quote older than the re-quote age
   * re-quotes and re-simulates first; it confirms when the new minimum out is within the
   * tolerance, and opens the next card version when it is worse. An answer after the expiry
   * closes the card as expired.
   */
  answer(
    answer: CardAnswer,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<AnswerResult, "not_found">>;
  /** The card timer: closes the card as expired once its time is up. */
  expire(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ExpiryResult, "not_found">>;
}

/** The ports the confirmations read the time, the intents, new quotes and simulations from. */
export interface ConfirmationsOptions {
  readonly clock: Clock;
  readonly store: ConfirmationStore;
  readonly quotes: QuoteSource;
  readonly simulator: Simulator;
}

/** What one attempt decided: an outcome, and the write it needs, if any. */
interface Decision<O> {
  readonly outcome: O;
  readonly write?: IntentWrite;
}

type Apply = (trigger: IntentTrigger) => Result<IntentStep, TransitionProblem>;

interface Attempt {
  readonly stored: StoredIntent;
  readonly apply: Apply;
}

type Requoted =
  | { readonly verdict: "requoted"; readonly requote: Requote }
  | Extract<AnswerOutcome, { readonly verdict: "requote_failed" }>;

// A write that lost the race reads the row again, and the next decision sees the card the winner
// left. Two answers settle in two attempts; the third covers a re-quote that opened a new card.
const maxAttempts = 3;
const cardTimer: IntentTrigger = { type: "card_timer_fired" };

// The first trigger the state machine accepts moves the intent; when none does, the first one's
// problem is the answer.
function firstStep(
  apply: Apply,
  first: IntentTrigger,
  others: readonly IntentTrigger[],
): Result<IntentStep, TransitionProblem> {
  const tried = apply(first);
  return tried.ok ? tried : (others.map(apply).find((step) => step.ok) ?? tried);
}

function writeOf(stored: StoredIntent, step: IntentStep, extra: Partial<IntentWrite>): IntentWrite {
  return { ...extra, intent: stored.intent, version: stored.version, step };
}

function expiryWrite(stored: StoredIntent, step: IntentStep): IntentWrite {
  return writeOf(stored, step, { closing: { outcome: "expired", atMs: step.event.atMs } });
}

function expired(stored: StoredIntent, step: IntentStep): Decision<AnswerOutcome> {
  return { outcome: { verdict: "expired" }, write: expiryWrite(stored, step) };
}

interface Confirming {
  readonly card: CardTerms;
  readonly answeredBy: Answerer;
  readonly requote?: Requote;
}

// The step's target is the verdict: confirmed, expired, or the next card version after a re-quote.
function settled(
  stored: StoredIntent,
  step: IntentStep,
  confirming: Confirming,
): Decision<AnswerOutcome> {
  const { card, answeredBy, requote } = confirming;
  const withRequote = requote === undefined ? {} : { requote };
  if (step.status.state === "expired") {
    return expired(stored, step);
  }
  if (step.status.state === "awaiting_confirmation") {
    return { outcome: { verdict: "reopened" }, write: writeOf(stored, step, withRequote) };
  }
  // The transition table leads a tap or a re-quote nowhere else but to confirmed.
  const closing = { outcome: "confirmed", answeredBy, atMs: step.event.atMs } as const;
  const confirmation = { cardVersion: card.version, expiresAtMs: card.expiresAtMs };
  const write = writeOf(stored, step, { closing, confirmation, ...withRequote });
  return { outcome: { verdict: "confirmed" }, write };
}

function deny({ stored, apply }: Attempt, answeredBy: Answerer): Decision<AnswerOutcome> {
  const step = firstStep(apply, cardTimer, [{ type: "deny_tapped" }]);
  if (!step.ok) {
    return { outcome: { verdict: "closed" } };
  }
  if (step.value.status.state === "expired") {
    return expired(stored, step.value);
  }
  const closing = { outcome: "denied", answeredBy, atMs: step.value.event.atMs } as const;
  return { outcome: { verdict: "denied" }, write: writeOf(stored, step.value, { closing }) };
}

// A Confirm on a card that is not the one on show still closes a card whose time is up.
function confirmOldCard({ stored, apply }: Attempt): Decision<AnswerOutcome> {
  const step = apply(cardTimer);
  if (step.ok) {
    return expired(stored, step.value);
  }
  return { outcome: { verdict: step.error === "not_expired" ? "card_changed" : "closed" } };
}

async function requoteIntent(
  options: ConfirmationsOptions,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<Requoted> {
  const built = await options.quotes.requote(intent, { signal });
  if (!built.ok) {
    return { verdict: "requote_failed", reason: built.error };
  }
  const simulation = await options.simulator.simulate(intent, built.value, { signal });
  if (!simulation.ok) {
    return { verdict: "requote_failed", reason: simulation.error };
  }
  return { verdict: "requoted", requote: { ...built.value, simulation: simulation.value } };
}

function requoteTrigger(answer: CardAnswer, stored: StoredIntent, requote: Requote): IntentTrigger {
  const { quotedAt, minOut } = requote.quote;
  return {
    type: "confirm_requoted",
    cardVersion: answer.cardVersion,
    requote: { quotedAtMs: quotedAt, minOutBase: minOut.base },
    cards: stored.cards,
  };
}

interface Confirm {
  readonly options: ConfirmationsOptions;
  readonly answer: CardAnswer;
  readonly signal: AbortSignal;
}

// A stale quote is quoted and simulated again before the tap counts. A re-quote that is itself
// older than the re-quote age by the time it lands counts as a venue that did not answer.
async function confirmStale(
  { options, answer, signal }: Confirm,
  attempt: Attempt,
  card: CardTerms,
): Promise<Decision<AnswerOutcome>> {
  const { stored, apply } = attempt;
  const requoted = await requoteIntent(options, stored.intent, signal);
  if (requoted.verdict === "requote_failed") {
    return { outcome: requoted };
  }
  const { requote } = requoted;
  const step = firstStep(apply, requoteTrigger(answer, stored, requote), [cardTimer]);
  if (step.ok) {
    return settled(stored, step.value, { card, answeredBy: answer.answeredBy, requote });
  }
  // The card is the one the tap read and has not expired, so only the re-quote's age is left.
  return { outcome: { verdict: "requote_failed", reason: "venue_down" } };
}

async function confirm(confirming: Confirm, attempt: Attempt): Promise<Decision<AnswerOutcome>> {
  const { answer } = confirming;
  const { stored, apply } = attempt;
  const { card } = stored.status;
  if (card?.version !== answer.cardVersion) {
    return confirmOldCard(attempt);
  }
  const tap: IntentTrigger = {
    type: "confirm_tapped",
    cardVersion: answer.cardVersion,
    cards: stored.cards,
  };
  const step = firstStep(apply, tap, [cardTimer]);
  if (step.ok) {
    return settled(stored, step.value, { card, answeredBy: answer.answeredBy });
  }
  return step.error === "quote_stale"
    ? confirmStale(confirming, attempt, card)
    : { outcome: { verdict: "closed" } };
}

function expireCard({ stored, apply }: Attempt): Decision<Pick<ExpiryResult, "verdict">> {
  const step = apply(cardTimer);
  if (step.ok) {
    return { outcome: { verdict: "expired" }, write: expiryWrite(stored, step.value) };
  }
  return { outcome: { verdict: step.error === "not_expired" ? "open" : "closed" } };
}

interface Settling<O> {
  readonly store: ConfirmationStore;
  readonly machine: IntentStateMachine;
  readonly intent: Id<"int">;
  readonly decide: (attempt: Attempt) => Promise<Decision<O>>;
  readonly signal: AbortSignal;
}

async function settle<O extends object>(
  settling: Settling<O>,
  attemptsLeft: number,
): Promise<Result<O & { readonly intent: StoredIntent }, "not_found">> {
  const { store, machine, intent, decide, signal } = settling;
  const stored = await store.read(intent, { signal });
  if (stored === undefined) {
    return err("not_found");
  }
  const apply: Apply = (trigger) => machine.apply(stored.status, trigger);
  const { outcome, write } = await decide({ stored, apply });
  if (write === undefined) {
    return ok({ ...outcome, intent: stored });
  }
  const written = await store.write(write, { signal });
  if (written.ok) {
    return ok({ ...outcome, intent: written.value });
  }
  if (attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "confirmation.contended",
      message: "Other writes kept moving the intent while an answer was stored.",
      retryable: true,
      details: { intent },
    });
  }
  return settle(settling, attemptsLeft - 1);
}

/** Creates the {@link Confirmations} on the state machine, with the given ports. */
export function createConfirmations(options: ConfirmationsOptions): Confirmations {
  const machine = createIntentStateMachine({ clock: options.clock });
  const { store } = options;
  return {
    answer: async (answer, { signal }) =>
      settle(
        {
          store,
          machine,
          intent: answer.intent,
          signal,
          decide: async (attempt) =>
            answer.decision === "deny"
              ? deny(attempt, answer.answeredBy)
              : confirm({ options, answer, signal }, attempt),
        },
        maxAttempts,
      ),
    expire: async (intent, { signal }) =>
      settle(
        { store, machine, intent, signal, decide: async (attempt) => expireCard(attempt) },
        maxAttempts,
      ),
  };
}
