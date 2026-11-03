import type { DatabaseSync } from "node:sqlite";
import { type Id, idSchema } from "@binference/core";
import {
  isAnswering,
  type WebhookAlertDraft,
  webhookAlertDraftSchema,
  webhookInboxKey,
  webhookInboxPayload,
  webhookRateWindowMs,
  webhookRepeatWindowMs,
  type WebhookRuleKey,
  webhookRuleKeySchema,
  type WebhookTake,
  webhookTakeSchema,
} from "@binference/engine/orders";
import type { Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { WebhookRulesTable } from "../databases/webhook-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText } from "../rows/column-values.js";
import { changedRows, rowCountSchema, timeInputSchema } from "../tasks/count-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";

type RuleRow = Pick<
  Selectable<WebhookRulesTable>,
  "id" | "secret_hash" | "state" | "rate_per_min" | "expires_at"
>;

function toRuleKey(row: RuleRow): WebhookRuleKey {
  return webhookRuleKeySchema.parse({
    id: row.id,
    secretHash: row.secret_hash,
    state: row.state,
    ratePerMinute: row.rate_per_min,
    ...field("expiresAtMs", row.expires_at),
  });
}

function readRule(database: DatabaseSync, id: Id<"whr">): WebhookRuleKey | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("webhook_rules")
      .select(["id", "secret_hash", "state", "rate_per_min", "expires_at"])
      .where("id", "=", id),
  );
  return row === undefined ? undefined : toRuleKey(row);
}

/** One rule's key, in any state, or none. */
export const findRuleTask: StoreTask<Id<"whr">, WebhookRuleKey | undefined> = defineTask({
  name: "webhooks.find_rule",
  access: "read",
  input: idSchema("whr"),
  output: webhookRuleKeySchema.optional(),
  run: readRule,
});

type Outcome = "accepted" | "repeat" | "rate";

// Judges an alert on the rule's accepted alerts of the windows before it, in the task's own
// transaction.
function outcomeOf(
  database: DatabaseSync,
  rule: WebhookRuleKey,
  draft: WebhookAlertDraft,
): Outcome {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const accepted = (windowMs: number) =>
    kysely
      .selectFrom("webhook_events")
      .where("rule_id", "=", draft.rule)
      .where("outcome", "=", "accepted")
      .where("received_at", ">", draft.receivedAtMs - windowMs);
  const { alertId } = draft;
  const repeat = takeFirst(
    accepted(webhookRepeatWindowMs)
      .select("id")
      .where((row) =>
        row.or([
          row("body_hash", "=", draft.bodyHash),
          ...(alertId === undefined ? [] : [row("alert_id", "=", alertId)]),
        ]),
      )
      .limit(1),
  );
  if (repeat !== undefined) {
    return "repeat";
  }
  const recent = takeFirst(
    accepted(webhookRateWindowMs).select((row) => row.fn.countAll<number>().as("count")),
  );
  return (recent?.count ?? 0) >= rule.ratePerMinute ? "rate" : "accepted";
}

// Writes an accepted alert's rule time and inbox entry, and answers the entry's id.
function admit(database: DatabaseSync, draft: WebhookAlertDraft, event: number): number {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .updateTable("webhook_rules")
      .set({ last_alert_at: draft.receivedAtMs })
      .where("id", "=", draft.rule),
  );
  const inserted = execute(
    kysely.insertInto("inbox").values({
      source: "webhook",
      source_key: webhookInboxKey(event),
      payload: jsonText(webhookInboxPayload(draft, event)),
      received_at: draft.receivedAtMs,
      handled_at: null,
    }),
  );
  return Number(inserted.insertId);
}

/**
 * Records an alert: `gone` when its rule no longer answers with the hash it matched, else its
 * `webhook_events` row, and for an accepted one the rule's last alert time and its inbox entry,
 * which holds its body.
 */
export const takeAlertTask: StoreTask<WebhookAlertDraft, WebhookTake> = defineTask({
  name: "webhooks.take",
  access: "write",
  input: webhookAlertDraftSchema,
  output: webhookTakeSchema,
  run(database, draft) {
    const rule = readRule(database, draft.rule);
    if (
      rule === undefined ||
      rule.secretHash !== draft.secretHash ||
      !isAnswering(rule, draft.receivedAtMs)
    ) {
      return { kind: "gone" };
    }
    const outcome = outcomeOf(database, rule, draft);
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const inserted = execute(
      kysely.insertInto("webhook_events").values({
        rule_id: draft.rule,
        alert_id: draft.alertId ?? null,
        body_hash: draft.bodyHash,
        received_at: draft.receivedAtMs,
        outcome,
        engine_locked: draft.isEngineLocked === true ? 1 : 0,
        intent_id: null,
      }),
    );
    const event = Number(inserted.insertId);
    return outcome === "accepted"
      ? { kind: outcome, event, entry: admit(database, draft, event) }
      : { kind: outcome, event };
  },
});

/** Deletes the `webhook_events` rows received before a time. */
export const pruneWebhookEventsTask: StoreTask<number, number> = defineTask({
  name: "webhooks.prune",
  access: "write",
  input: timeInputSchema,
  output: rowCountSchema,
  run(database, beforeMs) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    return changedRows(
      execute(kysely.deleteFrom("webhook_events").where("received_at", "<", beforeMs)),
    );
  },
});

/** Every task of the SQLite webhook alert store. */
export const webhookTasks: readonly TaskRunner[] = [
  findRuleTask,
  takeAlertTask,
  pruneWebhookEventsTask,
];
