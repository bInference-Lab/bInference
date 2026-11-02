import type { IntentRecord } from "../intents/intent-record.js";
import { stakeQuoteDocument } from "../intents/stake-quote.js";
import { noticePush } from "../pushes/notice-push.js";
import type { ExecutionRun } from "./executor-run.js";
import { standingApprovalOf } from "./standing-approval.js";

// The owner's notice of a liquid unstake's approval left standing.
const approvalLeftNoticeKey = "notice.stakeApprovalLeft";

/**
 * Tells the owner of the exact approval a liquid unstake left standing when its request, step
 * `index`, never landed after the approval did: it reverted, its cancel landed, or it was never
 * signed (decision 0331). The venue's request pulls receipt units only from the wallet that calls
 * it, so only the wallet's own unstake can spend the approval: it is told, not reset, as a launch's
 * is (decision 0289). Any other intent, or an unstake that ended at its approval, tells nothing.
 */
export function tellStakeApprovalLeft(
  run: Pick<ExecutionRun, "plan" | "parts">,
  ended: IntentRecord,
  index: number,
): void {
  if (ended.kind !== "stake" || ended.quote === undefined || ended.state === "cancelled") {
    return;
  }
  const approval = standingApprovalOf(run, index);
  if (approval === undefined) {
    return;
  }
  const { plan } = stakeQuoteDocument.decode(ended.quote);
  const notice = {
    key: approvalLeftNoticeKey,
    agent: ended.agentId,
    intent: ended.id,
    values: { venue: plan.validatorName },
    amounts: { approved: { asset: approval.asset, base: approval.amountBase } },
  };
  run.parts.publish(noticePush(notice));
}
