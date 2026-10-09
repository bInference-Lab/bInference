import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { noticePush } from "../pushes/notice-push.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";

// The owner's notices of an intent whose stuck step was dropped (decision 0115).
const droppedNoticeKey = "notice.stepDropped";
const droppedPartWayNoticeKey = "notice.stepDroppedPartWay";

/**
 * Ends an `executing` intent whose stuck step `index` was dropped (decision 0115):
 * `failed_onchain` with `stuck_dropped`, and the owner's notice, which says whether a step before
 * it landed. The step's transaction is `dropped` already, so the wallet's nonce is free again.
 */
export async function endDropped(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  index: number,
): Promise<undefined> {
  const ended = await moveIntent(run, snapshot, { type: "step_dropped" });
  if (ended === undefined) {
    return undefined;
  }
  const { id, agentId } = ended.record;
  run.parts.log.warn("executor.step_dropped", { intentId: id, chain: run.plan.chain.ref });
  const key = index > 0 ? droppedPartWayNoticeKey : droppedNoticeKey;
  run.parts.publish(noticePush({ key, agent: agentId, intent: id, values: {} }));
  return undefined;
}
