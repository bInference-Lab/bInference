import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { noticePush } from "../pushes/notice-push.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";

// The owner's notices of an intent ended on a step that was never signed (decision 0109).
const notSignedNoticeKey = "notice.notSigned";
const stepUnsentNoticeKey = "notice.stepUnsent";

/**
 * Ends an `executing` intent whose step `index` was never signed and never will be (decision
 * 0109): `cancelled` when it is the first step, so nothing reached the chain, and `failed_onchain`
 * with `step_unsent` once the steps before it landed. The owner gets a notice either way. It
 * signs nothing; a rescue, which retries its steps, stays as it is.
 */
export async function endUnsent(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  index: number,
): Promise<undefined> {
  const ended = await moveIntent(run, snapshot, { type: "step_unsent", hasSignedStep: index > 0 });
  if (ended === undefined) {
    return undefined;
  }
  const { id, agentId, state } = ended.record;
  run.parts.log.warn("executor.step_unsent", { intentId: id, errorCode: state });
  const key = state === "cancelled" ? notSignedNoticeKey : stepUnsentNoticeKey;
  run.parts.publish(noticePush({ key, agent: agentId, intent: id, values: {} }));
  return undefined;
}
