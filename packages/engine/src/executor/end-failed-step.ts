import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import { tellStakeApprovalLeft } from "./stake-approval-left.js";

/**
 * Ends an intent whose step `step` will never land: its transaction reverted, or its cancel
 * landed. A liquid unstake whose approval landed before it tells the owner the approval stands
 * (decision 0331).
 */
export async function endFailedStep(
  run: Pick<ExecutionRun, "plan" | "parts" | "signal">,
  snapshot: IntentSnapshot,
  failed: { readonly isCancel: boolean; readonly step: number },
): Promise<void> {
  const type = failed.isCancel ? "step_cancelled" : "step_reverted";
  const ended = await moveIntent(run, snapshot, { type });
  if (ended !== undefined) {
    tellStakeApprovalLeft(run, ended.record, failed.step);
  }
}
