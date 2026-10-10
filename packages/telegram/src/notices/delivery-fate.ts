import type { BinferenceError } from "@binference/core";

/**
 * What a send of a notice that failed means for its delivery (decision 0133): `retry` when
 * Telegram sent nothing and may take it later, `failed` when it refuses this message for good, and
 * `unknown` when the message may have reached the chat, so it is never sent again.
 */
export type DeliveryFate =
  | { readonly kind: "retry"; readonly afterMs: number }
  | { readonly kind: "failed" }
  | { readonly kind: "unknown" };

// The waits before a refused delivery is tried again: after the first attempt, the second, the
// third, and every later one.
const backoffMs = [5_000, 25_000, 120_000, 600_000] as const;
const lastBackoffMs = 600_000;
const blocked = 403;
const serverError = 500;

/** How long a delivery waits after its `attempts`-th refused attempt. */
export function backoffAfter(attempts: number): number {
  return backoffMs[Math.max(attempts, 1) - 1] ?? lastBackoffMs;
}

// A refusal of the Bot API: a 403 (the owner blocked the bot) and a 5xx may pass later; any other
// status refuses this message again.
function refusedFate(fault: BinferenceError, attempts: number): DeliveryFate {
  const status = fault.details["status"];
  const isRetried = status === blocked || (typeof status === "number" && status >= serverError);
  return isRetried ? { kind: "retry", afterMs: backoffAfter(attempts) } : { kind: "failed" };
}

function floodFate(fault: BinferenceError, attempts: number): DeliveryFate {
  const waitMs = fault.details["retryAfterMs"];
  return { kind: "retry", afterMs: typeof waitMs === "number" ? waitMs : backoffAfter(attempts) };
}

/**
 * The fate of a send that failed with `fault` on its `attempts`-th attempt, before any part of
 * the message went out. Telegram answered a refusal, so it sent nothing: a 429 waits the
 * `retry_after` it named, a 403 (the owner blocked the bot), a refused token and a 5xx wait out
 * the backoff, and any other status fails. A connection that never opened waits out the backoff.
 * Any other failure, or one the bot cannot name, may have reached the chat.
 */
export function deliveryFateOf(fault: BinferenceError | undefined, attempts: number): DeliveryFate {
  if (fault === undefined) {
    return { kind: "unknown" };
  }
  if (fault.code === "telegram.flood") {
    return floodFate(fault, attempts);
  }
  if (fault.code === "telegram.api_refused") {
    return refusedFate(fault, attempts);
  }
  const isUnsent =
    fault.code === "telegram.bad_token" ||
    (fault.code === "telegram.unreachable" && fault.details["isUnsent"] === true);
  return isUnsent ? { kind: "retry", afterMs: backoffAfter(attempts) } : { kind: "unknown" };
}
