import type { TurnHalt } from "./turn-halt.js";

/**
 * Why a call never ran: a message joined the turn, the turn reached its tool call limit, a
 * proposal was held back, a question gave way to the proposal beside it, the response was cut off
 * before the call was whole, or the turn halted.
 */
export type NotRunReason = "merge" | "limit" | "held_back" | "card_asks" | "cut_off" | TurnHalt;

const stopped = "not run: the owner stopped the agent";
const failed = "not run: the turn ended after a failure";

const texts: Readonly<Record<NotRunReason, string>> = {
  merge: "not run: a new message came in",
  limit: "not run: the turn reached its tool call limit",
  held_back: "not run: one proposal at a time; propose it again after the owner answers this one",
  card_asks: "not run: the card already asks the owner",
  cut_off: "not run: the response reached its output limit before this call was complete",
  owner: stopped,
  freeze: stopped,
  clear: stopped,
  runtime: "not run: the agent runtime stopped",
  time_limit: "not run: the turn reached its time limit",
  engine: failed,
  proposal_unknown: failed,
};

/** The result the model reads for a call that never ran, so every call keeps its result. */
export function notRunText(reason: NotRunReason): string {
  return texts[reason];
}
