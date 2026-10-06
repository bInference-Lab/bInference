import type { RetryPolicy } from "@binference/core";

/** The bounds and timeouts of a client. */
export interface ClientLimits {
  /** How long a call waits for its answer, across reconnects, unless the call sets its own. */
  readonly callTimeoutMs: number;
  /** How long one connection attempt may take to reach `ready`. */
  readonly handshakeTimeoutMs: number;
  /** The most calls waiting for an answer; one more is refused with `client.busy`. */
  readonly maxPendingCalls: number;
  /** How reconnecting backs off, with full jitter; when it is spent, the client closes. */
  readonly reconnect: RetryPolicy;
}

/**
 * The limits a client uses unless its options change them. A call resent after a reconnect stays
 * within the engine's burst of 60 calls, and reconnecting never gives up.
 */
export const defaultClientLimits: ClientLimits = {
  callTimeoutMs: 30_000,
  handshakeTimeoutMs: 10_000,
  maxPendingCalls: 60,
  reconnect: {
    attempts: Number.POSITIVE_INFINITY,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    budgetMs: Number.POSITIVE_INFINITY,
  },
};
