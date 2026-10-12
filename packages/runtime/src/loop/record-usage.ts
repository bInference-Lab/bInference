import { usageCost } from "../usage/usage-amount.js";
import type { ModelUsage } from "./model-event.js";
import type { ModelResponse } from "./read-model-response.js";
import type { TurnRun } from "./turn-run.js";

// An attempt that failed before its provider reported anything used nothing it could count.
const nothingUsed: ModelUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

/**
 * Records one attempt of a model call with the engine (`usage/record`, runtime spec, section 8.3),
 * an answer or a failure alike, before the loop acts on it: the model that was called, its tokens,
 * and its cost, the provider's own when it reports one, else its price, else $0. Each record has
 * its own key: the turn and the attempt's number in it. When the engine answers that nothing is
 * left of the budget, no model call follows. A record the engine does not take throws, and the
 * turn makes no further model call.
 */
export async function recordAttempt(
  run: TurnRun,
  at: number,
  response: ModelResponse,
): Promise<void> {
  const model = run.parts.models.models[at];
  const usage = response.usage ?? nothingUsed;
  const cost = usageCost(usage, model?.price);
  const attempt = run.tally.countAttempt();
  const record = {
    model: model?.name ?? "unknown/none",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    usdMicros: cost.usdMicros,
    key: `${run.turnId}.usage.${String(attempt)}`,
  };
  const recorded = await run.parts.engine.recordUsage(record, run.writes);
  if (recorded.budgetLeftMicros <= 0n) {
    run.tally.spendBudget();
  }
}
