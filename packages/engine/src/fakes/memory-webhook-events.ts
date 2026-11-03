import type { AlertFillRecord } from "../webhooks/alert-fill-record.js";
import type { WebhookEventQuery, WebhookEventRecord } from "../webhooks/webhook-event-record.js";
import type { MemoryEventRow } from "./memory-webhook-alert-store.js";

type Ended = Pick<AlertFillRecord, "outcome" | "reason" | "intentId">;

/**
 * One rule's alerts as the in-memory rule store lists them, the newest first, below `before` when
 * it is set: each row the alert store holds, with how its fill ended when it did.
 */
export function memoryEventsOf(
  rows: readonly MemoryEventRow[],
  ended: ReadonlyMap<number, Ended>,
  query: WebhookEventQuery,
): readonly WebhookEventRecord[] {
  const { ruleId, before, limit } = query;
  return rows
    .filter((row) => row.draft.rule === ruleId && (before === undefined || row.id < before))
    .toReversed()
    .slice(0, limit)
    .map((row) => {
      const { alertId, receivedAtMs } = row.draft;
      const end = ended.get(row.id);
      return structuredClone({
        event: row.id,
        ruleId,
        ...(alertId === undefined ? {} : { alertId }),
        receivedAtMs,
        taken: row.outcome,
        ...(end?.outcome === undefined ? {} : { outcome: end.outcome }),
        ...(end?.reason === undefined ? {} : { reason: end.reason }),
        ...(end?.intentId === undefined ? {} : { intentId: end.intentId }),
      });
    });
}
