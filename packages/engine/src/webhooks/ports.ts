import type { Id, Result } from "@binference/core";
import type {
  AlertAnnouncement,
  AlertFillQuery,
  AlertFillRecord,
  AlertFillWrite,
} from "./alert-fill-record.js";
import type { WebhookAlertDraft, WebhookRuleKey, WebhookTake } from "./webhook-alert.js";
import type { WebhookEventQuery, WebhookEventRecord } from "./webhook-event-record.js";
import type {
  WebhookRuleCreateRefusal,
  WebhookRuleDraft,
  WebhookRuleMove,
  WebhookRuleMoveRefusal,
  WebhookRuleQuery,
  WebhookRuleRecord,
} from "./webhook-rule-record.js";

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

/**
 * Keeps webhook rules and what became of each alert they accepted (database spec, section 2.4;
 * decisions 0299, 0337 and 0338). The rule operations and the rule fills decide each change, and
 * this store writes it under the version its writer read. A rule moves into `active` only while
 * its `webhookRule` intent holds a confirmation of its card and its agent is not frozen, both read
 * in the same write. Adapters: a SQLite store in `@binference/store`, and an in-memory fake that
 * shares its rules with the in-memory {@link WebhookAlertStore}.
 */
export interface WebhookRuleStore {
  /**
   * Stores a new rule `awaiting_confirmation`, with no fill, its URL changed at its time. An id in
   * use is `exists`, a frozen agent `frozen`, and an agent that holds 20 rules active or awaiting
   * their card `too_many`; each stores nothing. An unknown agent or wallet throws
   * `store.constraint`.
   */
  create(
    draft: WebhookRuleDraft,
    options: StoreCall,
  ): Promise<Result<WebhookRuleRecord, WebhookRuleCreateRefusal>>;
  /** One rule, or `undefined`. */
  get(id: Id<"whr">, options: StoreCall): Promise<WebhookRuleRecord | undefined>;
  /** The rule whose card the `webhookRule` intent carries, or `undefined`. */
  byIntent(intent: Id<"int">, options: StoreCall): Promise<WebhookRuleRecord | undefined>;
  /** Rules in the query's states, the oldest first, then by id. */
  list(query: WebhookRuleQuery, options: StoreCall): Promise<readonly WebhookRuleRecord[]>;
  /**
   * Writes one move of a rule and answers the rule after it. A move with a new secret hash changes
   * its URL at the move's time. A move out of `deleted` throws `store.constraint`.
   */
  move(
    move: WebhookRuleMove,
    options: StoreCall,
  ): Promise<Result<WebhookRuleRecord, WebhookRuleMoveRefusal>>;
  /** One accepted alert, or `undefined` for a row that is no accepted alert or is pruned. */
  alert(event: number, options: StoreCall): Promise<AlertFillRecord | undefined>;
  /** One rule's accepted alerts, the newest first. */
  alerts(query: AlertFillQuery, options: StoreCall): Promise<readonly AlertFillRecord[]>;
  /** One rule's alerts in any outcome, the newest first, below row `before` when it is set. */
  events(query: WebhookEventQuery, options: StoreCall): Promise<readonly WebhookEventRecord[]>;
  /**
   * Ends an accepted alert's fill as skipped, with its rule's move if it names one, in one write.
   * An alert that already ended is `ended`, one with no accepted row `not_found`, one whose live
   * fill the executor holds `held`, since only that fill's own move ends it, and a rule at another
   * version `stale`; each writes nothing. A fill is written with its intent's move, but for the
   * count of the alert's own live fill at `finalized` its reconciliation could not value, on its
   * rule or a deleted one (decision 0342); any other fill throws `store.constraint`.
   */
  endAlert(
    write: AlertFillWrite,
    options: StoreCall,
  ): Promise<Result<AlertFillRecord, "ended" | "not_found" | "stale" | "held">>;
  /** Accepted alerts whose notices were never announced, the oldest first, at most `limit`. */
  unannounced(limit: number, options: StoreCall): Promise<readonly AlertFillRecord[]>;
  /** Marks the notices of alerts announced; one announced before keeps its time. */
  markAnnounced(announcement: AlertAnnouncement, options: StoreCall): Promise<void>;
}
