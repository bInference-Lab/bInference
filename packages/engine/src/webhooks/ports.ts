import type { Id } from "@binference/core";
import type { WebhookAlertDraft, WebhookRuleKey, WebhookTake } from "./webhook-alert.js";

interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * The webhook rules as the listener reads them, and the record of each alert their URLs take
 * (spec 1, section 2.2; decision 0299). Rules are written by their operations; this port only
 * reads one by id and records alerts. Adapters: a SQLite store in `@binference/store`, and an
 * in-memory fake.
 */
export interface WebhookAlertStore {
  /** The rule's key, in any state, or `undefined` when no rule has the id. */
  findRule(id: Id<"whr">, options: StoreCall): Promise<WebhookRuleKey | undefined>;
  /**
   * Records an alert in one write, judged on the rows as they stand in that write. A rule that is
   * not answering at `receivedAtMs`, or whose secret hash is no longer the draft's, is `gone`
   * and nothing is written. Otherwise a `webhook_events` row is written: `repeat` when an accepted
   * alert of the rule carried the same `id` or body hash within `webhookRepeatWindowMs` before
   * it; `rate` when the rule accepted its `ratePerMinute` alerts within `webhookRateWindowMs`
   * before it; else `accepted`, with the rule's `last_alert_at` and an inbox entry under
   * `webhookInboxKey` of the row, whose payload is `webhookInboxPayload`: the rule, the row, the
   * alert's `id` and its body.
   */
  take(draft: WebhookAlertDraft, options: StoreCall): Promise<WebhookTake>;
  /** Deletes the `webhook_events` rows received before `beforeMs` and returns how many. */
  prune(beforeMs: number, options: StoreCall): Promise<number>;
}
