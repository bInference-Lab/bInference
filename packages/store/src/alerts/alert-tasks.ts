import type { DatabaseSync } from "node:sqlite";
import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type AlertDelete,
  alertDeleteSchema,
  type AlertExpiry,
  alertExpirySchema,
  type AlertHeld,
  alertHeldSchema,
  noticeHourMs,
  hasHeldToTell,
  type AlertQuery,
  alertQuerySchema,
  type AlertRecord,
  alertRecordSchema,
  maxActiveAlerts,
} from "@binference/engine/orders";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { hasTrackRoom, syncTrackedWallets } from "../leaders/tracked-sync.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { alertRowOf, readAlert, toAlertRecord, writeAlert } from "./alert-rows.js";

const records = z.array(alertRecordSchema);

type CreateRefusal = "not_found" | "too_many" | "track_limit";

// Why the alert cannot be stored, if it cannot: its agent unknown, holding 50 active alerts, or a
// wallet alert on a 51st account tracked across the install.
function refusalOf(database: DatabaseSync, alert: AlertRecord): CreateRefusal | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const agent = takeFirst(kysely.selectFrom("agents").select("id").where("id", "=", alert.agentId));
  if (agent === undefined) {
    return "not_found";
  }
  const active = kysely.selectFrom("alerts").where("state", "=", "active");
  const held = takeFirst(
    active
      .select((builder) => builder.fn.countAll<number>().as("count"))
      .where("agent_id", "=", alert.agentId),
  );
  if ((held?.count ?? 0) >= maxActiveAlerts) {
    return "too_many";
  }
  const { condition } = alert;
  if (condition.kind !== "wallet") {
    return undefined;
  }
  return hasTrackRoom(database, condition.account) ? undefined : "track_limit";
}

/** Stores a new active alert within the agent's and the install's limits. */
export const createAlertTask: StoreTask<
  AlertRecord,
  Result<AlertRecord, CreateRefusal>
> = defineTask({
  name: "alerts.create",
  access: "write",
  input: alertRecordSchema,
  output: resultSchema(alertRecordSchema, ["not_found", "too_many", "track_limit"]),
  run(database, alert) {
    const refusal = refusalOf(database, alert);
    if (refusal !== undefined) {
      return err(refusal);
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.insertInto("alerts").values(alertRowOf(alert)));
    syncTrackedWallets(database, alert.createdAtMs);
    return ok(alert);
  },
});

/** One alert, or none. */
export const getAlertTask: StoreTask<Id<"alr">, AlertRecord | undefined> = defineTask({
  name: "alerts.get",
  access: "read",
  input: idSchema("alr"),
  output: alertRecordSchema.optional(),
  run: (database, id) => readAlert(database, id),
});

/** The alerts a query names, oldest first. */
export const listAlertsTask: StoreTask<AlertQuery, readonly AlertRecord[]> = defineTask({
  name: "alerts.list",
  access: "read",
  input: alertQuerySchema,
  output: records,
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const { agentId, kind, after } = query;
    const inStates = kysely.selectFrom("alerts").selectAll().where("state", "in", query.states);
    const ofAgent = agentId === undefined ? inStates : inStates.where("agent_id", "=", agentId);
    const ofKind = kind === undefined ? ofAgent : ofAgent.where("kind", "=", kind);
    const ofAsset = query.asset === undefined ? ofKind : ofKind.where("asset", "=", query.asset);
    const paged =
      after === undefined
        ? ofAsset
        : ofAsset.where((where) =>
            where.or([
              where("created_at", ">", after.createdAtMs),
              where.and([where("created_at", "=", after.createdAtMs), where("id", ">", after.id)]),
            ]),
          );
    const ordered = paged.orderBy("created_at").orderBy("id").limit(query.limit);
    return execute(ordered).rows.map(toAlertRecord);
  },
});

// Moves an active alert to `state`.
function closeOne(database: DatabaseSync, change: AlertDelete, state: "deleted" | "ended") {
  const stored = readAlert(database, change.id);
  if (stored?.state !== "active") {
    return undefined;
  }
  const closed = writeAlert(database, { ...stored, state, changedAtMs: change.atMs });
  syncTrackedWallets(database, change.atMs);
  return closed;
}

/** Deletes an active alert. */
export const deleteAlertTask: StoreTask<AlertDelete, AlertRecord | undefined> = defineTask({
  name: "alerts.delete",
  access: "write",
  input: alertDeleteSchema,
  output: alertRecordSchema.optional(),
  run: (database, change) => closeOne(database, change, "deleted"),
});

/** Ends an active alert. */
export const endAlertTask: StoreTask<AlertDelete, AlertRecord | undefined> = defineTask({
  name: "alerts.end",
  access: "write",
  input: alertDeleteSchema,
  output: alertRecordSchema.optional(),
  run: (database, change) => closeOne(database, change, "ended"),
});

/** The alerts whose notice hour ended with matches held back, their counts cleared. */
export const heldNoticesTask: StoreTask<AlertExpiry, readonly AlertHeld[]> = defineTask({
  name: "alerts.heldNotices",
  access: "write",
  input: alertExpirySchema,
  output: z.array(alertHeldSchema),
  run(database, { atMs, limit }) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const due = kysely
      .selectFrom("alerts")
      .selectAll()
      .where("notices_held", ">", 0)
      .where("notice_window_at", "<=", atMs - noticeHourMs)
      .orderBy("created_at")
      .orderBy("id")
      .limit(limit);
    return execute(due).rows.flatMap((row) => {
      const { noticeWindow, ...alert } = toAlertRecord(row);
      if (noticeWindow === undefined || !hasHeldToTell(noticeWindow, atMs)) {
        return [];
      }
      const cleared = { ...alert, noticeWindow: { ...noticeWindow, held: 0 } };
      return [{ alert: writeAlert(database, cleared), held: noticeWindow.held }];
    });
  },
});

/** Ends the active alerts whose expiry came, the earliest first. */
export const expireAlertsTask: StoreTask<AlertExpiry, readonly AlertRecord[]> = defineTask({
  name: "alerts.expire",
  access: "write",
  input: alertExpirySchema,
  output: records,
  run(database, { atMs, limit }) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const due = kysely
      .selectFrom("alerts")
      .selectAll()
      .where("state", "=", "active")
      .where("expires_at", "<=", atMs)
      .orderBy("expires_at")
      .orderBy("id")
      .limit(limit);
    const ended = execute(due).rows.map((row) =>
      writeAlert(database, { ...toAlertRecord(row), state: "ended", changedAtMs: atMs }),
    );
    if (ended.length > 0) {
      syncTrackedWallets(database, atMs);
    }
    return ended;
  },
});
