import type { ModelFailure } from "./model-event.js";

/** At most this many attempts make one model call, retries and fallbacks together. */
const maxAttempts = 4;

/** The same model is tried again at most this many times. */
const maxRetries = 2;

/** The longest wait a provider may ask for before the same model is tried again. */
const maxRetryAfterMs = 60_000;

/** The waits before the first and the second retry when the provider asked for none. */
const backoffMs: readonly number[] = [1_000, 4_000];

/** What a failed attempt says, and where the call stands. */
export interface FailedAttempt {
  readonly failure: ModelFailure;
  /** The wait the provider asked for. */
  readonly retryAfterMs?: number | undefined;
  /** The attempts made so far in this call, this one included. */
  readonly attempts: number;
  /** The times this model was tried again in this call. */
  readonly retries: number;
  /** The turn's proposal started: no model is tried again or swapped. */
  readonly committed: boolean;
}

/** What follows a failed attempt; `rest` asks the model's provider to rest at least that long. */
export type AttemptStep =
  | { readonly kind: "retry"; readonly waitMs: number }
  | { readonly kind: "next"; readonly restMs?: number }
  | { readonly kind: "end"; readonly restMs?: number };

// A provider that kept failing for a passing cause rests, at least as long as it asked.
function rested(kind: "next" | "end", retryAfterMs: number | undefined): AttemptStep {
  return { kind, restMs: retryAfterMs ?? 0 };
}

function afterTransient(attempt: FailedAttempt): AttemptStep {
  const asked = attempt.retryAfterMs;
  const canWait = asked === undefined || asked <= maxRetryAfterMs;
  if (canWait && attempt.retries < maxRetries && attempt.attempts < maxAttempts) {
    return { kind: "retry", waitMs: asked ?? backoffMs[attempt.retries] ?? 0 };
  }
  return rested(attempt.attempts < maxAttempts ? "next" : "end", asked);
}

/**
 * The step after a failed attempt (runtime spec, section 8.2; decision 0188). A committed turn, a
 * stop, a provider's refusal and a context overflow end the call. A `transient` failure tries the
 * same model again up to 2 times, after the provider's `Retry-After` when it is at most 60 s, else
 * after 1 s then 4 s; then, or when the provider asked for longer, its provider rests and the next
 * model takes over. `auth`, `billing` and `request` go to the next model at once. No call makes
 * more than 4 attempts.
 */
export function stepAfter(attempt: FailedAttempt): AttemptStep {
  const ends: readonly ModelFailure[] = ["aborted", "refused", "context"];
  if (attempt.committed || ends.includes(attempt.failure)) {
    return { kind: "end" };
  }
  if (attempt.failure === "transient") {
    return afterTransient(attempt);
  }
  return { kind: attempt.attempts < maxAttempts ? "next" : "end" };
}
