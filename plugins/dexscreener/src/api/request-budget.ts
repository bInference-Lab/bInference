import { BinferenceError, type Clock } from "@binference/plugin-sdk";

/** At most `max` requests in any `windowMs`. */
interface CallWindow {
  readonly max: number;
  readonly windowMs: number;
}

/**
 * DEX Screener's two published limits: 300 requests a minute on the pairs, tokens, token pairs
 * and search endpoints, and 60 a minute on the profiles, boosts, orders, takeovers, ads and metas.
 */
export type EndpointGroup = "pairs" | "feeds";

/** Hands out each request's turn under its group's limit, and pauses a group a 429 refused. */
export interface RequestBudget {
  /**
   * Resolves once a request of the group may go, counting it. A turn further away than the
   * budget's longest wait rejects at once with a retryable `dexscreener.rate_limited`, which
   * names the wait in `details.retryAfterMs`; a signal that aborts rejects with its reason.
   */
  take(group: EndpointGroup, signal: AbortSignal): Promise<void>;
  /** Lets no request of the group go for `pauseMs` from now. */
  pause(group: EndpointGroup, pauseMs: number): void;
}

/** What a {@link RequestBudget} is made from. */
export interface RequestBudgetOptions {
  readonly clock: Clock;
  readonly windows: Readonly<Record<EndpointGroup, CallWindow>>;
  /** The longest a request waits for its turn before it fails as rate limited. */
  readonly maxWaitMs: number;
}

/** A rate-limit fault that says when to ask again. */
export function rateLimited(retryAfterMs: number): BinferenceError {
  return new BinferenceError({
    code: "dexscreener.rate_limited",
    message: "DEX Screener's rate limit holds this request back.",
    retryable: true,
    details: { retryAfterMs },
  });
}

/**
 * Creates the {@link RequestBudget} of one process: a sliding window of the requests sent per
 * group, so the source never sends more than DEX Screener publishes, retries included.
 */
export function createRequestBudget(options: RequestBudgetOptions): RequestBudget {
  const { clock, windows, maxWaitMs } = options;
  const sent: Record<EndpointGroup, number[]> = { pairs: [], feeds: [] };
  const pausedUntil: Record<EndpointGroup, number> = { pairs: 0, feeds: 0 };

  // How long until the group's next request may go: 0 when it may go now.
  const waitOf = (group: EndpointGroup, now: number): number => {
    const { max, windowMs } = windows[group];
    const times = sent[group].filter((at) => at > now - windowMs);
    sent[group] = times;
    const [oldest = now] = times;
    const windowWait = times.length < max ? 0 : oldest + windowMs - now;
    return Math.max(windowWait, pausedUntil[group] - now, 0);
  };

  const take = async (group: EndpointGroup, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    const waitMs = waitOf(group, clock.now());
    if (waitMs === 0) {
      sent[group].push(clock.now());
      return;
    }
    if (waitMs > maxWaitMs) {
      throw rateLimited(waitMs);
    }
    await clock.sleep(waitMs, signal);
    await take(group, signal);
  };

  return {
    take,
    pause(group, pauseMs) {
      pausedUntil[group] = Math.max(pausedUntil[group], clock.now() + pauseMs);
    },
  };
}
