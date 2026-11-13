import { createDeadline } from "@binference/core";
import { usageCost } from "../usage/usage-amount.js";
import type { ModelUsage } from "./model-event.js";
import type { ModelResponse } from "./read-model-response.js";
import type { ChainModel } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

// An attempt that failed before its provider reported anything used nothing it could count.
const nothingUsed: ModelUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

type UsageRecord = Parameters<TurnRun["parts"]["engine"]["recordUsage"]>[0];

// The record of a call a halt cut is one of the turn's end writes, bounded by an end write's time,
// so the turn ends before the engine lapses it (decision 0442); any other waits on the turn's
// writes.
async function recordWithin(run: TurnRun, record: UsageRecord) {
  if (!run.halted.aborted) {
    return run.parts.engine.recordUsage(record, run.writes);
  }
  const { clock } = run.parts;
  const timeoutMs = run.limits.endWriteTimeoutMs;
  const deadline = createDeadline({ clock, signal: run.writes, timeoutMs });
  try {
    return await run.parts.engine.recordUsage(record, deadline.signal);
  } finally {
    deadline.clear();
  }
}

/**
 * Records one attempt of a model call with the engine (`usage/record`, runtime spec, section 8.3),
 * an answer or a failure alike, before the loop acts on it: the model that was called, its tokens,
 * and its cost, the provider's own when it reports one, else its price, else $0. Each record has
 * its own key: the turn and the attempt's number in it. When the engine answers that nothing is
 * left of the budget, no model call follows. A record the engine does not take throws, and the
 * turn makes no further model call. The record of a call a halt cut, such as the turn's 10 minutes,
 * waits at most an end write's time.
 */
export async function recordAttempt(
  run: TurnRun,
  model: ChainModel | undefined,
  response: ModelResponse,
): Promise<void> {
  const usage = response.usage ?? nothingUsed;
  const cost = usageCost(usage, model?.price);
  const attempt = run.tally.countAttempt(cost.usdMicros);
  const record = {
    model: model?.name ?? "unknown/none",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    usdMicros: cost.usdMicros,
    key: `${run.turnId}.usage.${String(attempt)}`,
  };
  const recorded = await recordWithin(run, record);
  run.tail.budget(recorded.budgetLeftMicros);
  if (recorded.budgetLeftMicros <= 0n) {
    run.tally.spendBudget(recorded.resumesAt);
  }
}
