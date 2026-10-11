import type { TurnRun } from "./turn-run.js";

/**
 * Whether a waiting message may join the turn at a merge point: only where a model call can follow
 * to answer it. A halted or committed turn, or one at its model call limit, takes no message, and
 * the message starts the next turn instead (runtime spec, sections 3.4 and 6.1).
 */
export function canMerge(run: TurnRun): boolean {
  const { committed, modelCalls } = run.tally.now();
  return !run.halted.aborted && !committed && modelCalls < run.limits.maxModelCalls;
}
