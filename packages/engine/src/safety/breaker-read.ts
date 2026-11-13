import { BinferenceError, type Clock, err, ok, type Result } from "@binference/core";
import { type BreakerState, breakerStateSchema } from "../breaker/breaker-state.js";
import type { BreakerSource } from "../ports.js";
import { throwIfLeaseLost } from "../records/lease-lost.js";

// How long one read of the breaker may take before the look counts it unread (decision 0439).
const breakerReadMs = 2_000;

type BreakerRead = Result<BreakerState, string>;

// The source's answer, or its fault's code; a lost lease passes through.
async function answerOf(source: BreakerSource, signal: AbortSignal): Promise<BreakerRead> {
  try {
    return ok(breakerStateSchema.parse(await source.read({ signal })));
  } catch (error) {
    throwIfLeaseLost(error);
    return err(error instanceof BinferenceError ? error.code : "breaker.unreadable");
  }
}

/**
 * Reads the breaker within 2 seconds of the clock, whatever its source does with the signal: a
 * read that has not settled by then is `breaker.timeout`, and the signal it was given aborts. A
 * source's fault answers its code; the caller's own abort rejects.
 */
export async function readBreaker(
  parts: { readonly source: BreakerSource; readonly clock: Clock },
  signal: AbortSignal,
): Promise<BreakerRead> {
  const done = new AbortController();
  const read = AbortSignal.any([signal, done.signal]);
  const late = parts.clock.sleep(breakerReadMs, read).then(
    () => err("breaker.timeout"),
    () => err("breaker.timeout"),
  );
  try {
    const answer = await Promise.race([answerOf(parts.source, read), late]);
    signal.throwIfAborted();
    return answer;
  } finally {
    done.abort();
  }
}
