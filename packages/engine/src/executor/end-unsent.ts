import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { noticePush } from "../pushes/notice-push.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import { launchUnsentNotice } from "./launch-unsent-notice.js";
import { daySumsNotice, type ServiceRefusal, serviceRefusalReason } from "./service-refusal.js";
import { tellStakeApprovalLeft } from "./stake-approval-left.js";

// The owner's notices of an intent ended on a step that was never signed (decision 0109).
const notSignedNoticeKey = "notice.notSigned";
const stepUnsentNoticeKey = "notice.stepUnsent";

/** The step that was never signed, and the signer service's refusal of it, if that is why. */
export interface UnsentStep {
  readonly index: number;
  readonly refusal?: ServiceRefusal;
}

/**
 * Ends an `executing` intent whose step was never signed and never will be (decision 0109):
 * `cancelled` when it is the first step, so nothing reached the chain, and `failed_onchain` with
 * `step_unsent` once the steps before it landed. A signer service's refusal is stored in the place
 * of `step_unsent`, `day_sums` or `signer_locked` (decision 0427). The owner gets a notice either
 * way: `notice.daySums` for a step over the user's 24-hour sums, a launch's own words for a
 * launch, and a liquid unstake's approval that stands is told. It signs nothing; a rescue, which
 * retries its steps, stays as it is.
 */
export async function endUnsent(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  step: UnsentStep,
): Promise<undefined> {
  const { index, refusal } = step;
  const reason = refusal === undefined ? {} : { refusal: serviceRefusalReason(refusal) };
  const trigger = { type: "step_unsent", hasSignedStep: index > 0, ...reason } as const;
  const ended = await moveIntent(run, snapshot, trigger);
  if (ended === undefined) {
    return undefined;
  }
  const { id, agentId, state } = ended.record;
  run.parts.log.warn("executor.step_unsent", { intentId: id, errorCode: state });
  if (refusal?.error === "over_sums") {
    const { sums } = refusal;
    const chainName = run.plan.chain.definition.name;
    run.parts.publish(daySumsNotice({ agent: agentId, intent: id, chainName, sums }));
    tellStakeApprovalLeft(run, ended.record, index);
    return undefined;
  }
  if (ended.record.kind === "launchToken") {
    run.parts.publish(launchUnsentNotice(run, ended.record, index));
    return undefined;
  }
  const key = state === "cancelled" ? notSignedNoticeKey : stepUnsentNoticeKey;
  run.parts.publish(noticePush({ key, agent: agentId, intent: id, values: {} }));
  tellStakeApprovalLeft(run, ended.record, index);
  return undefined;
}
