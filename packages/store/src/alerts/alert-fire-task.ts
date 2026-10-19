import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import { type AgentInboxMessage, maxUntakenMessages } from "@binference/engine/chat";
import {
  alertAfterFire,
  type AlertFireDraft,
  alertFireDraftSchema,
  alertFireKeepMs,
  type AlertFireWritten,
  alertFireWrittenSchema,
  type AlertRecord,
  type AlertWake,
  type AlertWakeOutcome,
  alertWakeWindowMs,
  canFire,
  maxAlertWakesPerHour,
  wakeAnswerOf,
} from "@binference/engine/orders";
import {
  insertMessage,
  sessionFor,
  toAgentInboxMessage,
  untakenCount,
} from "../agent-inbox/agent-inbox-writes.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { readAlert, writeAlert } from "./alert-rows.js";

// Replaces the payload of the alert's last wake-up while it waits untaken, and reads it back.
function replaceWaiting(
  database: DatabaseSync,
  alert: AlertRecord,
  wake: AlertWake,
): AgentInboxMessage | undefined {
  const { lastMessageId } = alert;
  if (lastMessageId === undefined) {
    return undefined;
  }
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const untaken = kysely
    .updateTable("agent_inbox")
    .set({ payload: jsonText(wake.payload) })
    .where("id", "=", lastMessageId)
    .where("taken_at", "is", null);
  const changed = execute(untaken).numAffectedRows ?? 0n;
  if (changed === 0n) {
    return undefined;
  }
  const row = takeFirst(
    kysely.selectFrom("agent_inbox").selectAll().where("id", "=", lastMessageId),
  );
  return row === undefined ? undefined : toAgentInboxMessage(row);
}

function recentWakes(database: DatabaseSync, alert: AlertRecord, atMs: number): number {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("alert_fires")
      .select((builder) => builder.fn.countAll<number>().as("count"))
      .where("agent_id", "=", alert.agentId)
      .where("outcome", "=", "woke")
      .where("at", ">", atMs - alertWakeWindowMs),
  );
  return row?.count ?? 0;
}

// A new wake-up, unless the agent's alerts woke it 10 times in the last hour or its inbox is full.
function newWake(
  database: DatabaseSync,
  alert: AlertRecord,
  call: { readonly wake: AlertWake; readonly atMs: number },
): AlertWakeOutcome {
  const { wake, atMs } = call;
  if (recentWakes(database, alert, atMs) >= maxAlertWakesPerHour) {
    return { outcome: "skipped", reason: "hourly" };
  }
  if (untakenCount(database, alert.agentId) >= maxUntakenMessages) {
    return { outcome: "skipped", reason: "busy" };
  }
  const sessionId = sessionFor(database, alert.agentId, wake.opens) ?? wake.opens;
  const message = insertMessage(database, {
    id: wake.id,
    agentId: alert.agentId,
    sessionId,
    kind: "inbox/alertFired",
    turnId: wake.turnId,
    payload: wake.payload,
    createdAtMs: atMs,
  });
  return { outcome: "woke", message };
}

function wakeOf(
  database: DatabaseSync,
  alert: AlertRecord,
  draft: AlertFireDraft,
): AlertWakeOutcome {
  const { wake, skip, atMs } = draft;
  if (skip !== undefined) {
    return { outcome: "skipped", reason: skip };
  }
  if (wake === undefined) {
    return { outcome: "quiet" };
  }
  const waiting = replaceWaiting(database, alert, wake);
  return waiting === undefined
    ? newWake(database, alert, { wake, atMs })
    : { outcome: "replaced", message: waiting };
}

// The wake-ups the hourly limit held back since the agent's last one, in the rows still kept.
function heldBack(database: DatabaseSync, alert: AlertRecord): number {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const ofAgent = kysely.selectFrom("alert_fires").where("agent_id", "=", alert.agentId);
  const last = takeFirst(
    ofAgent.select((builder) => builder.fn.max("at").as("at")).where("outcome", "=", "woke"),
  );
  const since = last?.at ?? -1;
  const row = takeFirst(
    ofAgent
      .select((builder) => builder.fn.countAll<number>().as("count"))
      .where("reason", "=", "hourly")
      .where("at", ">=", since),
  );
  return row?.count ?? 0;
}

// Records the fire's row, and forgets the agent's rows older than a week.
function keep(
  database: DatabaseSync,
  alert: AlertRecord,
  run: {
    readonly draft: AlertFireDraft;
    readonly wake: AlertWakeOutcome;
  },
): void {
  const { draft, wake } = run;
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .deleteFrom("alert_fires")
      .where("agent_id", "=", alert.agentId)
      .where("at", "<", draft.atMs - alertFireKeepMs),
  );
  execute(
    kysely.insertInto("alert_fires").values({
      alert_id: alert.id,
      fires: draft.expectedFires + 1,
      agent_id: alert.agentId,
      at: draft.atMs,
      outcome: wake.outcome,
      reason: wake.outcome === "skipped" ? wake.reason : null,
      message_id: "message" in wake ? wake.message.id : null,
    }),
  );
}

/**
 * Records one fire of an alert that can take it, stores, replaces or skips its wake-up, and moves
 * the alert on, in one transaction.
 */
export const fireAlertTask: StoreTask<
  AlertFireDraft,
  Result<AlertFireWritten, "stale">
> = defineTask({
  name: "alerts.fire",
  access: "write",
  input: alertFireDraftSchema,
  output: resultSchema(alertFireWrittenSchema, ["stale"]),
  run(database, draft) {
    const alert = readAlert(database, draft.id);
    if (alert === undefined || !canFire(alert, draft)) {
      return err("stale");
    }
    const wake = wakeOf(database, alert, draft);
    const wakeSkipped = wake.outcome === "woke" ? heldBack(database, alert) : 0;
    keep(database, alert, { draft, wake });
    const after = alertAfterFire(alert, draft.atMs);
    const lastMessage = "message" in wake ? { lastMessageId: wake.message.id } : {};
    const written = writeAlert(database, { ...after, ...lastMessage });
    return ok({ alert: written, ...wakeAnswerOf(wake, wakeSkipped) });
  },
});
