import type { DatabaseSync } from "node:sqlite";
import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type AlertDelete,
  alertDeleteSchema,
  type AlertExpiry,
  alertExpirySchema,
  type AlertQuery,
  alertQuerySchema,
  type AlertRecord,
  alertRecordSchema,
  maxActiveAlerts,
  maxTrackedWallets,
} from "@binference/engine/orders";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
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
  const tracked = active.where("account", "is not", null);
  const same = takeFirst(tracked.select("id").where("account", "=", condition.account));
  const accounts = takeFirst(
    tracked.select((builder) => builder.fn.count<number>("account").distinct().as("count")),
  );
  return same === undefined && (accounts?.count ?? 0) >= maxTrackedWallets
    ? "track_limit"
    : undefined;
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
    const paged =
      after === undefined
        ? ofKind
        : ofKind.where((where) =>
            where.or([
              where("created_at", ">", after.createdAtMs),
              where.and([where("created_at", "=", after.createdAtMs), where("id", ">", after.id)]),
            ]),
          );
    const ordered = paged.orderBy("created_at").orderBy("id").limit(query.limit);
    return execute(ordered).rows.map(toAlertRecord);
  },
});

/** Deletes an active alert. */
export const deleteAlertTask: StoreTask<AlertDelete, AlertRecord | undefined> = defineTask({
  name: "alerts.delete",
  access: "write",
  input: alertDeleteSchema,
  output: alertRecordSchema.optional(),
  run(database, { id, atMs }) {
    const stored = readAlert(database, id);
    return stored?.state === "active"
      ? writeAlert(database, { ...stored, state: "deleted", changedAtMs: atMs })
      : undefined;
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
    return execute(due).rows.map((row) =>
      writeAlert(database, { ...toAlertRecord(row), state: "ended", changedAtMs: atMs }),
    );
  },
});
