import type { IncludedSteps } from "./execute-in-slot.js";
import type { ExecutionRun } from "./executor-run.js";
import { reconcileTrade } from "./reconcile-trade.js";
import { watchFinality } from "./watch-finality.js";

/**
 * Takes an intent whose every step a block holds the rest of the way: it watches each step not
 * yet final until its block is, then reconciles the trade (ARCHITECTURE.md section 7, steps 8 and
 * 9). It runs off the wallet's queue: the wallet's next intent need not wait for finality.
 */
export async function settleIncluded(run: ExecutionRun, included: IncludedSteps): Promise<void> {
  const pending = included.steps.filter(({ state }) => state !== "final");
  const finalized = await watchFinality(run, included.included, pending);
  if (finalized !== undefined) {
    await reconcileTrade(run, finalized);
  }
}
