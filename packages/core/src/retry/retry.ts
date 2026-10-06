import { BinferenceError } from "../errors/binference-error.js";
import type { Clock, Random } from "../ports.js";

/** How often and how long to retry. */
export interface RetryPolicy {
  /** The most attempts in all; the first one always runs. */
  readonly attempts: number;
  /** The cap on the first wait; each later wait doubles it. */
  readonly baseDelayMs: number;
  /** The cap on any one wait. */
  readonly maxDelayMs: number;
  /** No wait starts that would end past this much time since the first attempt. */
  readonly budgetMs: number;
}

/** A retry policy with the signal that stops it and the ports it waits through. */
export interface RetryOptions extends RetryPolicy {
  readonly signal: AbortSignal;
  readonly clock: Clock;
  readonly random: Random;
}

/** What one attempt receives. */
export interface RetryAttempt {
  /** 1 for the first attempt. */
  readonly attempt: number;
  readonly signal: AbortSignal;
}

const uint32Range = 2 ** 32;

function randomFraction(random: Random): number {
  const bytes = random.bytes(4);
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) / uint32Range;
}

// Full jitter: a uniform wait between zero and the capped exponential delay.
function backoffDelayMs(options: RetryOptions, attempt: number): number {
  const ceilingMs = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(randomFraction(options.random) * ceilingMs);
}

function isTransient(error: Readonly<Error>): boolean {
  return error instanceof BinferenceError && error.retryable;
}

async function attemptFrom<T>(
  operation: (attempt: RetryAttempt) => Promise<T>,
  options: RetryOptions,
  progress: { readonly attempt: number; readonly startedAtMs: number },
): Promise<T> {
  options.signal.throwIfAborted();
  try {
    return await operation({ attempt: progress.attempt, signal: options.signal });
  } catch (error) {
    if (!(error instanceof Error) || !isTransient(error) || progress.attempt >= options.attempts) {
      throw error;
    }
    const delayMs = backoffDelayMs(options, progress.attempt);
    if (options.clock.now() + delayMs - progress.startedAtMs > options.budgetMs) {
      throw error;
    }
    await options.clock.sleep(delayMs, options.signal);
    return attemptFrom(operation, options, { ...progress, attempt: progress.attempt + 1 });
  }
}

/**
 * Runs an operation and retries it after a transient fault: a `BinferenceError` marked
 * retryable. Waits back off exponentially with full jitter, within the attempt count and the time
 * budget. An abort stops it at once with the signal's reason. Never wrap an operation that has
 * caused a side effect before it failed.
 */
export async function retry<T>(
  operation: (attempt: RetryAttempt) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  return attemptFrom(operation, options, { attempt: 1, startedAtMs: options.clock.now() });
}
