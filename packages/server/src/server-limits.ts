import type { AuthFailureLimits } from "./auth-failures.js";
import type { LockoutAlertLimits } from "./lockout-alerts.js";

/**
 * The bounds and timeouts of a protocol server. Each one holds per connection unless it says
 * otherwise; over a call limit, the call fails with `protocol.busy` or `protocol.too_large`.
 * Failed sign-ins and pairings count per source address and per credential (`AuthFailureLimits`),
 * and a lockout is reported at most once per key within `authAlertEveryMs`.
 */
export interface ServerLimits extends AuthFailureLimits, LockoutAlertLimits {
  /** The largest frame after sign-in, in bytes. */
  readonly maxFrameBytes: number;
  /** The largest frame before `ready`, in bytes: `open` and `prove` are small. */
  readonly maxSignInFrameBytes: number;
  /** The most calls a connection may have running at once. */
  readonly maxCallsInFlight: number;
  /** How many calls a second a connection may make once its burst is spent. */
  readonly callsPerSecond: number;
  /** How many calls a connection may make at once before the rate applies. */
  readonly callBurst: number;
  /** The most connections open at once, over both transports; one more is refused with 503. */
  readonly maxConnections: number;
  /** How long a connection may take from its first byte to `ready`. */
  readonly signInTimeoutMs: number;
  /** How often the server pings each connection. */
  readonly pingIntervalMs: number;
  /** How long a connection may go without a pong before the server drops it. */
  readonly pongTimeoutMs: number;
  /** How long a call may run before it fails with `engine.timeout`. */
  readonly callTimeoutMs: number;
  /** The most bytes waiting to reach a slow client; past it, the server drops the connection. */
  readonly maxBufferedBytes: number;
  /** The most idempotent writes running at once across the server. */
  readonly maxWritesInFlight: number;
  /** How many pushes each topic keeps for clients that resume from a `seq`. */
  readonly maxPushesPerTopic: number;
  /** How long a topic keeps a push for clients that resume from a `seq`. */
  readonly pushRetentionMs: number;
  /** The most push topics across the server; a push to one more topic is refused. */
  readonly maxTopics: number;
  /** The most topics one connection may subscribe to. */
  readonly maxTopicsPerConnection: number;
  /** How long `close` waits for clients to answer `bye` before it cuts their sockets. */
  readonly closeGraceMs: number;
}

/**
 * The limits a server uses unless its options change them: the spec's 1 MiB frames, 64 calls in
 * flight and 20 calls a second with a burst of 60, a 10-second sign-in, a ping every 20 seconds and
 * a drop after 60 seconds without a pong, pushes kept for 10 minutes or 1,000 per topic, and a
 * source or credential that fails to sign in or pair 10 times within a minute refused for 5
 * minutes, and the owner told of such a lockout at most once in 15 minutes per source or credential.
 */
export const defaultServerLimits: ServerLimits = {
  maxFrameBytes: 1024 * 1024,
  maxSignInFrameBytes: 64 * 1024,
  maxCallsInFlight: 64,
  callsPerSecond: 20,
  callBurst: 60,
  maxConnections: 64,
  signInTimeoutMs: 10_000,
  pingIntervalMs: 20_000,
  pongTimeoutMs: 60_000,
  callTimeoutMs: 30_000,
  maxBufferedBytes: 8 * 1024 * 1024,
  maxWritesInFlight: 1_024,
  maxPushesPerTopic: 1_000,
  pushRetentionMs: 10 * 60_000,
  maxTopics: 1_024,
  maxTopicsPerConnection: 64,
  closeGraceMs: 1_000,
  authMaxFailures: 10,
  authFailureWindowMs: 60_000,
  authLockoutMs: 5 * 60_000,
  maxAuthKeys: 4_096,
  authAlertEveryMs: 15 * 60_000,
};
