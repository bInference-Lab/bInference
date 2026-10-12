import type { CommittingAppend } from "./transcript-event.js";
import type { TurnRecord } from "./turn-record.js";

/**
 * Why a committing append may not be written beyond any append's refusal: its turn is not one of
 * the session's, an event names another turn, or the turn has ended.
 */
export function commitRefusalOf(
  turn: TurnRecord | undefined,
  append: CommittingAppend,
): "no_turn" | "ended" | undefined {
  if (turn?.sessionId !== append.sessionId) {
    return "no_turn";
  }
  if (append.events.some((event) => event.turnId !== append.turn)) {
    return "no_turn";
  }
  return turn.endedAtMs === undefined ? undefined : "ended";
}
