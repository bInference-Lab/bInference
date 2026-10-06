import type { BinferenceError, Clock } from "@binference/core";

/** What {@link pollUntil} asks, until when, and what it throws when time runs out. */
export interface Poll {
  readonly isDone: () => Promise<boolean>;
  /** Epoch milliseconds on the clock. */
  readonly until: number;
  readonly failure: () => BinferenceError;
}

const pollMs = 250;

/**
 * Asks `isDone` every 250 ms until it answers true, for a service manager that acts after it
 * answers, such as launchd letting a job go. Throws `poll.failure()` once `poll.until` has passed.
 */
export async function pollUntil(clock: Clock, poll: Poll, signal: AbortSignal): Promise<void> {
  if (await poll.isDone()) {
    return;
  }
  if (clock.now() >= poll.until) {
    throw poll.failure();
  }
  await clock.sleep(pollMs, signal);
  await pollUntil(clock, poll, signal);
}
