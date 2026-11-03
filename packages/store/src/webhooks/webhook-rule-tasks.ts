import { type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type AlertAnnouncement,
  alertAnnouncementSchema,
  type AlertFillQuery,
  alertFillQuerySchema,
  type AlertFillRecord,
  alertFillRecordSchema,
  type AlertFillWrite,
  alertFillWriteSchema,
  type WebhookEventQuery,
  webhookEventQuerySchema,
  type WebhookEventRecord,
  webhookEventRecordSchema,
  type WebhookRuleCreateRefusal,
  type WebhookRuleDraft,
  webhookRuleDraftSchema,
  type WebhookRuleMove,
  type WebhookRuleMoveRefusal,
  webhookRuleMoveSchema,
  type WebhookRuleQuery,
  webhookRuleQuerySchema,
  type WebhookRuleRecord,
  webhookRuleRecordSchema,
} from "@binference/engine/orders";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";
import {
  acceptedRow,
  refused,
  ruleRow,
  toAlertRecord,
  toEventRecord,
  toRuleRecord,
} from "./webhook-rule-rows.js";
import {
  checkAlertEnd,
  checkRuleMove,
  createRule,
  writeAlertEnd,
  writeRuleMove,
} from "./webhook-rule-writes.js";

const ruleRecords = z.array(webhookRuleRecordSchema);
const alertRecords = z.array(alertFillRecordSchema);

/** Stores a new rule awaiting its card. */
export const createRuleTask: StoreTask<
  WebhookRuleDraft,
  Result<WebhookRuleRecord, WebhookRuleCreateRefusal>
> = defineTask({
  name: "webhookRules.create",
  access: "write",
  input: webhookRuleDraftSchema,
  output: resultSchema(webhookRuleRecordSchema, ["exists", "frozen", "too_many"]),
  run: createRule,
});

/** Reads one rule. */
export const getRuleTask: StoreTask<Id<"whr">, WebhookRuleRecord | undefined> = defineTask({
  name: "webhookRules.get",
  access: "read",
  input: idSchema("whr"),
  output: webhookRuleRecordSchema.optional(),
  run(database, id) {
    const row = ruleRow(database, id);
    return row === undefined ? undefined : toRuleRecord(row);
  },
});

/** Reads the rule whose card a `webhookRule` intent carries. */
export const ruleByIntentTask: StoreTask<Id<"int">, WebhookRuleRecord | undefined> = defineTask({
  name: "webhookRules.byIntent",
  access: "read",
  input: idSchema("int"),
  output: webhookRuleRecordSchema.optional(),
  run(database, intent) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("webhook_rules").selectAll().where("intent_id", "=", intent),
    );
    return row === undefined ? undefined : toRuleRecord(row);
  },
});

/** Lists rules in some states, the oldest first, then by id. */
export const listRulesTask: StoreTask<WebhookRuleQuery, readonly WebhookRuleRecord[]> = defineTask({
  name: "webhookRules.list",
  access: "read",
  input: webhookRuleQuerySchema,
  output: ruleRecords,
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const { agentId } = query;
    let select = kysely
      .selectFrom("webhook_rules")
      .selectAll()
      .where("state", "in", [...query.states]);
    if (agentId !== undefined) {
      select = select.where("agent_id", "=", agentId);
    }
    const ordered = select.orderBy("created_at").orderBy("id").limit(query.limit);
    return execute(ordered).rows.map(toRuleRecord);
  },
});

/** Writes one move of a rule. */
export const moveRuleTask: StoreTask<
  WebhookRuleMove,
  Result<WebhookRuleRecord, WebhookRuleMoveRefusal>
> = defineTask({
  name: "webhookRules.move",
  access: "write",
  input: webhookRuleMoveSchema,
  output: resultSchema(webhookRuleRecordSchema, ["not_found", "stale", "not_confirmed", "frozen"]),
  run(database, move) {
    const checked = checkRuleMove(database, move);
    return checked.ok ? ok(writeRuleMove(database, move)) : checked;
  },
});

/** Reads one accepted alert. */
export const alertTask: StoreTask<number, AlertFillRecord | undefined> = defineTask({
  name: "webhookRules.alert",
  access: "read",
  input: z.int().positive(),
  output: alertFillRecordSchema.optional(),
  run(database, event) {
    const row = acceptedRow(database, event);
    return row === undefined ? undefined : toAlertRecord(row);
  },
});

/** Reads one rule's accepted alerts, the newest first. */
export const alertsTask: StoreTask<AlertFillQuery, readonly AlertFillRecord[]> = defineTask({
  name: "webhookRules.alerts",
  access: "read",
  input: alertFillQuerySchema,
  output: alertRecords,
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = execute(
      kysely
        .selectFrom("webhook_events")
        .selectAll()
        .where("rule_id", "=", query.ruleId)
        .where("outcome", "=", "accepted")
        .orderBy("id", "desc")
        .limit(query.limit),
    ).rows;
    return rows.map(toAlertRecord);
  },
});

/** Reads one rule's alerts in any outcome but `rejected`, the newest first, below a row. */
export const eventsTask: StoreTask<WebhookEventQuery, readonly WebhookEventRecord[]> = defineTask({
  name: "webhookRules.events",
  access: "read",
  input: webhookEventQuerySchema,
  output: z.array(webhookEventRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const ofRule = kysely
      .selectFrom("webhook_events")
      .selectAll()
      .where("rule_id", "=", query.ruleId)
      .where("outcome", "in", ["accepted", "repeat", "rate"]);
    const below = query.before === undefined ? ofRule : ofRule.where("id", "<", query.before);
    return execute(below.orderBy("id", "desc").limit(query.limit)).rows.map(toEventRecord);
  },
});

/** Ends an accepted alert as a skip, with its rule's move, in one transaction. */
export const endAlertTask: StoreTask<
  AlertFillWrite,
  Result<AlertFillRecord, "ended" | "not_found" | "stale">
> = defineTask({
  name: "webhookRules.endAlert",
  access: "write",
  input: alertFillWriteSchema,
  output: resultSchema(alertFillRecordSchema, ["ended", "not_found", "stale"]),
  run(database, write) {
    if (write.outcome !== "skipped") {
      throw refused("A fill ends its alert with its intent's move.", {});
    }
    const checked = checkAlertEnd(database, write);
    if (!checked.ok) {
      return checked;
    }
    writeAlertEnd(database, write);
    const row = acceptedRow(database, write.event);
    if (row === undefined) {
      throw refused("An alert did not read back after its end.", {});
    }
    return ok(toAlertRecord(row));
  },
});

/** Reads the accepted alerts whose notices were never announced, the oldest first. */
export const unannouncedAlertsTask: StoreTask<number, readonly AlertFillRecord[]> = defineTask({
  name: "webhookRules.unannounced",
  access: "read",
  input: z.int().min(1).max(1_000),
  output: alertRecords,
  run(database, limit) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = execute(
      kysely
        .selectFrom("webhook_events")
        .selectAll()
        .where("notices", "is not", null)
        .where("announced_at", "is", null)
        .orderBy("id")
        .limit(limit),
    ).rows;
    return rows.map(toAlertRecord);
  },
});

/** Marks alerts' notices announced; one announced before keeps its time. */
export const markAlertsAnnouncedTask: StoreTask<AlertAnnouncement, undefined> = defineTask({
  name: "webhookRules.markAnnounced",
  access: "write",
  input: alertAnnouncementSchema,
  output: z.undefined(),
  run(database, { events, atMs }) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .updateTable("webhook_events")
        .set({ announced_at: atMs })
        .where("id", "in", [...events])
        .where("notices", "is not", null)
        .where("announced_at", "is", null),
    );
    return undefined;
  },
});

/** Every task of the SQLite webhook rule store. */
export const webhookRuleTasks: readonly TaskRunner[] = [
  createRuleTask,
  getRuleTask,
  ruleByIntentTask,
  listRulesTask,
  moveRuleTask,
  alertTask,
  alertsTask,
  eventsTask,
  endAlertTask,
  unannouncedAlertsTask,
  markAlertsAnnouncedTask,
];
