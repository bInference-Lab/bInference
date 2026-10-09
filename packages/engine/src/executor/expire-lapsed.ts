import { isFillAuthorization } from "../intents/authorization.js";
import { cardExpiresAt } from "../intents/card-rules.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { noticePush } from "../pushes/notice-push.js";
import { type ExecutorParts, moveIntent } from "./executor-run.js";

/** The owner's notice of a trade whose confirmation ran out before it was sent (decision 0120). */
const lapsedNoticeKey = "notice.confirmationLapsed";

// When what authorized a confirmed intent runs out: the owner's confirmation, or the auto grant,
// which lasts the card lifetime its kind would have had. An order or a webhook rule decides for
// its own fills.
function expiryOf(snapshot: IntentSnapshot): number | undefined {
  const { record, history, stored } = snapshot;
  const { authorizedBy } = stored.status;
  if (authorizedBy === undefined) {
    return stored.confirmation?.expiresAtMs;
  }
  const confirmed = history.events.find((event) => event.toState === "confirmed");
  return isFillAuthorization(authorizedBy) || confirmed === undefined
    ? undefined
    : cardExpiresAt(record.kind, confirmed.atMs, stored.cards);
}

// Expires one intent whose authorization ran out, and answers whether it still waits.
async function stillWaits(
  parts: ExecutorParts,
  record: IntentRecord,
  signal: AbortSignal,
): Promise<boolean> {
  const snapshot = await parts.stored.snapshot(record.id, { signal });
  const expiresAtMs = snapshot === undefined ? undefined : expiryOf(snapshot);
  if (snapshot === undefined || expiresAtMs === undefined || parts.clock.now() < expiresAtMs) {
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
      return (await stillWaits(parts, record, signal)) ? [...kept, record] : kept;
    },
    Promise.resolve([]),
  );
  return waits;
}
