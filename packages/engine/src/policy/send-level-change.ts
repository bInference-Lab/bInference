import type { SendLevelState } from "../agents/send-level-record.js";
import type { SendLevel } from "./policy-rules.js";

/**
 * How long a looser setting waits before it takes effect: 24 hours (ARCHITECTURE.md section 11),
 * so a hijacked surface cannot quietly loosen what guards the funds.
 */
export const looseningWaitMs = 86_400_000;

/** What a request for a send level does: the state to write, and whether it loosens. */
export interface SendLevelMove {
  readonly next: SendLevelState;
  /** The level asked is looser than the one in effect: the caller needs the `loosen` scope. */
  readonly loosens: boolean;
}

/**
 * The send level in effect at `nowMs`: a pending level whose time has come replaces the level,
 * and one still waiting stays pending. Every reader of a stored state goes through this.
 */
export function sendLevelAt(state: SendLevelState, nowMs: number): SendLevelState {
  const { pending } = state;
  return pending !== undefined && pending.atMs <= nowMs ? { level: pending.level } : state;
}

/**
 * Moves the send level toward the level asked, judged against the level in effect at `nowMs`.
 * A stricter level, or the level in effect, applies at once and drops any looser level that
 * waits, failing closed. A looser level waits 24 hours; asking again for the one that already
 * waits keeps its time, and asking for another starts the wait again.
 */
export function moveSendLevel(
  state: SendLevelState,
  asked: SendLevel,
  nowMs: number,
): SendLevelMove {
  const settled = sendLevelAt(state, nowMs);
  if (asked >= settled.level) {
    return { next: { level: asked }, loosens: false };
  }
  const pending =
    settled.pending?.level === asked
      ? settled.pending
      : { level: asked, atMs: nowMs + looseningWaitMs };
  return { next: { level: settled.level, pending }, loosens: true };
}
