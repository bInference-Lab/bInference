import { BinferenceError, type ErrorCode } from "@binference/core";
import { type BreakerState, breakerStateSchema } from "../breaker/breaker-state.js";
import type { BreakerSource } from "../ports.js";

/**
 * A breaker source in memory that a test pulls, lifts and makes fail, shaped like the hosted
 * reader of the breaker's row: each move raises the version by one.
 */
export interface MemoryBreaker extends BreakerSource {
  /** Pulls the breaker at `atMs`, raising its version. */
  pull(atMs: number): void;
  /** Lifts the breaker at `atMs`, raising its version. */
  lift(atMs: number): void;
  /** Answers this state from the next read on, such as an older version a lagging copy holds. */
  answer(state: BreakerState): void;
  /** Rejects every later read with a fault of this code, or answers again once `undefined`. */
  fail(code: ErrorCode | undefined): void;
}

/** Creates a {@link MemoryBreaker}, lifted at version 0. */
export function createMemoryBreaker(): MemoryBreaker {
  let state: BreakerState = { pulled: false, version: 0 };
  let failing: ErrorCode | undefined;
  const move = (next: { readonly pulled: boolean; readonly atMs: number }): void => {
    state = { pulled: next.pulled, version: state.version + 1, changedAtMs: next.atMs };
  };
  return {
    pull: (atMs) => {
      move({ pulled: true, atMs });
    },
    lift: (atMs) => {
      move({ pulled: false, atMs });
    },
    answer: (next) => {
      state = breakerStateSchema.parse(next);
    },
    fail: (code) => {
      failing = code;
    },
    read: async ({ signal }) => {
      signal.throwIfAborted();
      if (failing !== undefined) {
        throw new BinferenceError({
          code: failing,
          message: "The breaker's row cannot be read.",
          retryable: true,
        });
      }
      return Promise.resolve({ ...state });
    },
  };
}
