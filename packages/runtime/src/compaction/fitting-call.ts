import { callModel } from "../loop/model-call.js";
import type { ModelFault, ModelResponse } from "../loop/read-model-response.js";
import type { ModelRequest } from "../loop/turn-records.js";
import type { TurnRun } from "../loop/turn-run.js";
import { compactHistory } from "./compact-history.js";
import type { TurnHistory } from "./turn-history.js";

// The call does not go out: the turn halted or its budget ran out while a summary was written.
const notCalled: ModelFault = {
  ok: false,
  failure: "aborted",
  message: "The model call was not made.",
  text: "",
  reasoning: "",
};

function mayCall(run: TurnRun): boolean {
  return !run.halted.aborted && !run.tally.now().budgetSpent;
}

// A call whose answer gives its provider's count of what it sent.
async function measuredCall(
  run: TurnRun,
  history: TurnHistory,
  request: ModelRequest,
): Promise<ModelResponse> {
  const response = await callModel(run, request);
  if (response.ok) {
    history.measure(request, response.usage);
  }
  return response;
}

/**
 * One model call of the turn that fits its context (runtime spec, section 7.3): when the
 * estimated input with the output reserve passes 80% of the window, the history is compacted
 * first; after a `context` failure, it is compacted to fit the window that failure showed, and
 * the call is made once more if a summary was written. A compaction that wrote nothing before the
 * call is not tried again after it. `request` builds the call from the conversation as it stands.
 */
export async function callFitting(
  run: TurnRun,
  request: () => Promise<ModelRequest>,
): Promise<ModelResponse> {
  const { history } = run;
  const first = await request();
  if (history === undefined) {
    return callModel(run, first);
  }
  const windowTokens = history.compaction.contextTokens;
  const sized = history.overThreshold(first) ? await compactHistory(run, windowTokens) : undefined;
  if (!mayCall(run)) {
    return notCalled;
  }
  const sent = sized === true ? await request() : first;
  const response = await measuredCall(run, history, sent);
  if (response.ok || response.failure !== "context" || sized === false) {
    return response;
  }
  // The provider's window is smaller than the call it refused.
  const shown = Math.min(windowTokens, history.estimate(sent));
  if (!(await compactHistory(run, shown)) || !mayCall(run)) {
    return response;
  }
  return measuredCall(run, history, await request());
}
