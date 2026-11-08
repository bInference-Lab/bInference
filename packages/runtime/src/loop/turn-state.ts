import type { TurnState } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

/**
 * Where the turn stands now: the model its route calls, its outside mark, and the estimate of its
 * next call's input against the window, when the turn compacts. The estimate leaves out the
 * volatile tail, which is small, so it reads a little low.
 */
export function turnStateOf(run: TurnRun): TurnState {
  const { models } = run.parts.models;
  const model = (models[run.route.at()] ?? models[0])?.name ?? "";
  const { history } = run;
  const context =
    history === undefined
      ? undefined
      : {
          usedTokens: history.estimate({
            prefix: run.prefix,
            messages: run.messages,
            tools: run.parts.tools.declarations,
          }),
          windowTokens: history.compaction.contextTokens,
        };
  return {
    model,
    outside: run.tally.now().outside,
    ...(context === undefined ? {} : { context }),
  };
}
