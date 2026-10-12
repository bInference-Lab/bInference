import type { Clock } from "@binference/core";

/** A published limit: at most `max` requests in any `windowMs`. */
export interface CallWindow {
  readonly max: number;
  readonly windowMs: number;
}

/** Hands out each request's turn under its group's limit, and pauses a group a 429 refused. */
export interface RequestBudget<Group extends string> {
  /**
   * Resolves once a request of the group may go, counting it. A turn further away than the
   * budget's longest wait rejects at once with the error `tooLong` makes of the wait; a signal
   * that aborts rejects with its reason.
   */
  take(group: Group, signal: AbortSignal): Promise<void>;
  /** Lets no request of the group go for `pauseMs` from now. */
  pause(group: Group, pauseMs: number): void;
}

/** What a {@link RequestBudget} is made from. */
export interface RequestBudgetOptions<Group extends string> {
  readonly clock: Clock;
  /** Each group of endpoints and the limit its service publishes for it. */
  readonly windows: Readonly<Record<Group, CallWindow>>;
  /** The longest a request waits for its turn before it fails. */
  readonly maxWaitMs: number;
  /** The fault of a request whose turn is `waitMs` away, past the longest wait. */
  readonly tooLong: (waitMs: number) => Error;
}

/**
 * Creates the {@link RequestBudget} of one process: a sliding window of the requests sent per
 * group, so a data source never sends more than its service publishes, retries included.
 */
export function createRequestBudget<Group extends string>(
  options: RequestBudgetOptions<Group>,
): RequestBudget<Group> {
  const { clock, windows, maxWaitMs, tooLong } = options;
  const sent = new Map<Group, number[]>();
  const pausedUntil = new Map<Group, number>();

  // How long until the group's next request may go: 0 when it may go now.
  const waitOf = (group: Group, now: number): number => {
    const { max, windowMs } = windows[group];
    const times = (sent.get(group) ?? []).filter((at) => at > now - windowMs);
    sent.set(group, times);
    const [oldest = now] = times;
    const windowWait = times.length < max ? 0 : oldest + windowMs - now;
    return Math.max(windowWait, (pausedUntil.get(group) ?? 0) - now, 0);
  };

  const take = async (group: Group, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    const waitMs = waitOf(group, clock.now());
    if (waitMs === 0) {
      sent.get(group)?.push(clock.now());
      return;
    }
    if (waitMs > maxWaitMs) {
      throw tooLong(waitMs);
    }
    await clock.sleep(waitMs, signal);
    await take(group, signal);
  };

  return {
    take,
    pause(group, pauseMs) {
      pausedUntil.set(group, Math.max(pausedUntil.get(group) ?? 0, clock.now() + pauseMs));
    },
  };
}
