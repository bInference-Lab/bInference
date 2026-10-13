import type { Id } from "@binference/core";
import { cardExpiresAt } from "../intents/card-rules.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { noticePush } from "../pushes/notice-push.js";
import { type ExecutorParts, moveIntent } from "./executor-run.js";

/** The owner's notice of a trade whose confirmation ran out before it was sent (decision 0120). */
const lapsedNoticeKey = "notice.confirmationLapsed";

// When what authorized a confirmed intent runs out: the owner's confirmation, or the auto grant or
// an order fill's grant, which last the card lifetime its kind would have had (decision 0210).
function expiryOf(snapshot: IntentSnapshot): number | undefined {
  const { record, history, stored } = snapshot;
  const { authorizedBy } = stored.status;
  if (authorizedBy === undefined) {
    return stored.confirmation?.expiresAtMs;
  }
  const confirmed = history.events.find((event) => event.toState === "confirmed");
  return confirmed === undefined
    ? undefined
    : cardExpiresAt(record.kind, confirmed.atMs, stored.cards);
}

/**
 * Moves one confirmed live intent whose confirmation or auto grant ran out to `expired`, and tells
 * the owner with `notice.confirmationLapsed` (decision 0120); nothing is signed. Answers whether
 * it still waits for a queue: `false` once it expired, or when it is no longer `confirmed`.
 */
export async function expireIfLapsed(
  parts: ExecutorParts,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<boolean> {
  const snapshot = await parts.stored.snapshot(intent, { signal });
  if (snapshot?.record.state !== "confirmed") {
    return false;
  }
  const { record } = snapshot;
  const expiresAtMs = expiryOf(snapshot);
  if (expiresAtMs === undefined || parts.clock.now() < expiresAtMs) {
    return true;
  }
  const expired = await moveIntent({ parts, signal }, snapshot, {
    type: "authorization_lapsed",
    expiresAtMs,
  });
  if (expired === undefined) {
    return true;
  }
  parts.log.warn("executor.lapsed", { intentId: record.id });
  const notice = { key: lapsedNoticeKey, agent: record.agentId, intent: record.id, values: {} };
  parts.publish(noticePush(notice));
  return false;
}

/** The owner's notice of a trade whose confirmation ran out while the fee was above the cap. */
const feeAboveCapNoticeKey = "notice.feeAboveCap";

/**
 * Gives a tapped intent whose confirmation ran out while the queue waited for the fee per gas to
 * fall to the network fee cap the next card version, for a new confirmation, and tells the owner
 * with `notice.feeAboveCap` (decision 0143); nothing is signed. Any other intent is left to
 * {@link expireIfLapsed}. Answers whether it still waits for a queue.
 */
export async function reopenIfFeeLapsed(
  parts: ExecutorParts,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<boolean> {
  const snapshot = await parts.stored.snapshot(intent, { signal });
  const expiresAtMs = snapshot?.stored.confirmation?.expiresAtMs;
  if (
    snapshot?.record.state !== "confirmed" ||
    snapshot.stored.status.authorizedBy !== undefined ||
    expiresAtMs === undefined
  ) {
    return expireIfLapsed(parts, intent, signal);
  }
  if (parts.clock.now() < expiresAtMs) {
    return true;
  }
  const { cards } = snapshot.stored;
  const reopened = await moveIntent({ parts, signal }, snapshot, {
    type: "fee_wait_lapsed",
    expiresAtMs,
    cards,
  });
  if (reopened === undefined) {
    return true;
  }
  const { agentId } = snapshot.record;
  parts.log.warn("executor.fee_wait_lapsed", { intentId: intent });
  parts.publish(noticePush({ key: feeAboveCapNoticeKey, agent: agentId, intent, values: {} }));
  return false;
}

/**
 * Moves each confirmed live intent whose confirmation or auto grant ran out while the engine was
 * stopped or locked to `expired`, and tells the owner with `notice.confirmationLapsed`; nothing is
 * signed (decision 0120). Answers the intents that still wait for a queue, in their order.
 */
export async function expireLapsed(
  parts: ExecutorParts,
  confirmed: readonly IntentRecord[],
  signal: AbortSignal,
): Promise<readonly IntentRecord[]> {
  const waits = await confirmed.reduce<Promise<readonly IntentRecord[]>>(
    async (earlier, record) => {
      const kept = await earlier;
      return (await expireIfLapsed(parts, record.id, signal)) ? [...kept, record] : kept;
    },
    Promise.resolve([]),
  );
  return waits;
}
