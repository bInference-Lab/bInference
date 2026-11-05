import { BinferenceError } from "@binference/core";
import {
  type AlertFillRecord,
  alertFillRecordSchema,
  type WebhookEventRecord,
  webhookEventRecordSchema,
  type WebhookRuleDraft,
  type WebhookRuleRecord,
  webhookRuleRecordSchema,
  webhookRuleRequestDocument,
} from "@binference/engine/orders";
import type { Insertable, Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { WebhookEventsTable, WebhookRulesTable } from "../databases/webhook-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, readJson } from "../rows/column-values.js";

/** A broken rule of a webhook write, which rolls its task back. */
export function refused(
  message: string,
  details: Readonly<Record<string, string>>,
): BinferenceError {
  return new BinferenceError({ code: "store.constraint", message, details });
}

// The notice hour a rule keeps in three columns, when it has one.
function hourOf(row: Selectable<WebhookRulesTable>) {
  return row.notice_window_at === null
    ? {}
    : {
        noticeHour: {
          startedAtMs: row.notice_window_at,
          sent: row.notices_sent,
          held: row.notices_held,
        },
      };
}

/** Reads one `webhook_rules` row as its record. A rule no operation made, with no wallet, throws. */
export function toRuleRecord(row: Selectable<WebhookRulesTable>): WebhookRuleRecord {
  if (row.wallet_id === null || row.intent_id === null || row.url_changed_at === null) {
    throw refused("A webhook rule no operation made has no record.", { rule: row.id });
  }
  return webhookRuleRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    walletId: row.wallet_id,
    request: readJson(row.action),
    ratePerMinute: row.rate_per_min,
    ...field("maxFills", row.max_fills),
    expiresAtMs: row.expires_at,
    intentId: row.intent_id,
    isPaper: row.paper === 1,
    state: row.state,
    fills: row.fills,
    ...field("cardId", row.card_id),
    ...field("lastAlertAtMs", row.last_alert_at),
    urlChangedAtMs: row.url_changed_at,
    oldUrlLastEvent: row.old_url_last_event,
    ...hourOf(row),
    createdAtMs: row.created_at,
    changedAtMs: row.changed_at,
    version: row.version,
  });
}

/** The row a new rule is stored as, awaiting its card. */
export function ruleRowOf(draft: WebhookRuleDraft): Insertable<WebhookRulesTable> {
  return {
    id: draft.id,
    agent_id: draft.agentId,
    wallet_id: draft.walletId,
    name: draft.request.name,
    secret_hash: draft.secretHash,
    action: jsonText(webhookRuleRequestDocument.encode(draft.request)),
    state: "awaiting_confirmation",
    rate_per_min: draft.ratePerMinute,
    max_fills: draft.maxFills ?? null,
    expires_at: draft.expiresAtMs,
    intent_id: draft.intentId,
    paper: draft.isPaper ? 1 : 0,
    url_changed_at: draft.atMs,
    created_at: draft.atMs,
    changed_at: draft.atMs,
  };
}

/** One rule's row, or `undefined`. */
export function ruleRow(
  database: StoreConnection,
  id: string,
): Selectable<WebhookRulesTable> | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(kysely.selectFrom("webhook_rules").selectAll().where("id", "=", id));
}

/** Reads one accepted alert's row as its record. */
export function toAlertRecord(row: Selectable<WebhookEventsTable>): AlertFillRecord {
  return alertFillRecordSchema.parse({
    event: row.id,
    ruleId: row.rule_id,
    ...field("alertId", row.alert_id),
    receivedAtMs: row.received_at,
    wasEngineLocked: row.engine_locked === 1,
    ...field("outcome", row.fill_outcome),
    ...field("reason", row.fill_reason),
    ...field("intentId", row.intent_id),
    ...(row.notices === null ? {} : { notices: readJson(row.notices) }),
    ...field("announcedAtMs", row.announced_at),
  });
}

/** Reads one alert's row as the owner's list of a rule's alerts shows it. */
export function toEventRecord(row: Selectable<WebhookEventsTable>): WebhookEventRecord {
  return webhookEventRecordSchema.parse({
    event: row.id,
    ruleId: row.rule_id,
    ...field("alertId", row.alert_id),
    receivedAtMs: row.received_at,
    taken: row.outcome,
    ...field("outcome", row.fill_outcome),
    ...field("reason", row.fill_reason),
    ...field("intentId", row.intent_id),
  });
}

/** One accepted alert's row, or `undefined` for a row that is no accepted alert. */
export function acceptedRow(
  database: StoreConnection,
  event: number,
): Selectable<WebhookEventsTable> | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(
    kysely
      .selectFrom("webhook_events")
      .selectAll()
      .where("id", "=", event)
      .where("outcome", "=", "accepted"),
  );
}
