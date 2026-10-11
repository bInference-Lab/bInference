import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import {
  maxWebPushSubscriptionsPerDevice,
  type WebPushDrop,
  webPushDropSchema,
  type WebPushSubscriptionRecord,
  webPushSubscriptionRecordSchema,
} from "@binference/engine/access";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { WebPushSubscriptionsTable } from "../databases/access-tables.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

function toSubscription(row: Selectable<WebPushSubscriptionsTable>): WebPushSubscriptionRecord {
  return webPushSubscriptionRecordSchema.parse({
    endpoint: row.endpoint,
    deviceId: row.device_id,
    p256dh: row.p256dh,
    auth: row.auth,
    serverKey: row.server_key,
    createdAtMs: row.created_at,
  });
}

function isActiveDevice(database: DatabaseSync, id: string): boolean {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const device = takeFirst(
    kysely.selectFrom("devices").select("id").where("id", "=", id).where("revoked_at", "is", null),
  );
  return device !== undefined;
}

/**
 * Drops every browser push subscription of a device, inside the task that revokes it (decision
 * 0158).
 */
export function dropDeviceSubscriptions(database: DatabaseSync, deviceId: string): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(kysely.deleteFrom("web_push_subscriptions").where("device_id", "=", deviceId));
}

/**
 * Saves a device's subscription in place of one at its endpoint, then deletes the device's oldest
 * past `maxWebPushSubscriptionsPerDevice`; a revoked device is refused.
 */
export const saveWebPushSubscriptionTask: StoreTask<
  WebPushSubscriptionRecord,
  Result<WebPushSubscriptionRecord, "no_device">
> = defineTask({
  name: "access.save_web_push_subscription",
  access: "write",
  input: webPushSubscriptionRecordSchema,
  output: resultSchema(webPushSubscriptionRecordSchema, ["no_device"]),
  run(database, subscription) {
    if (!isActiveDevice(database, subscription.deviceId)) {
      return err("no_device");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const replaced = {
      device_id: subscription.deviceId,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      server_key: subscription.serverKey,
      created_at: subscription.createdAtMs,
    };
    execute(
      kysely
        .insertInto("web_push_subscriptions")
        .values({ endpoint: subscription.endpoint, ...replaced })
        .onConflict((conflict) => conflict.column("endpoint").doUpdateSet(replaced)),
    );
    const newest = kysely
      .selectFrom("web_push_subscriptions")
      .select("endpoint")
      .where("device_id", "=", subscription.deviceId)
      .orderBy("created_at", "desc")
      .orderBy("endpoint", "desc")
      .limit(maxWebPushSubscriptionsPerDevice);
    execute(
      kysely
        .deleteFrom("web_push_subscriptions")
        .where("device_id", "=", subscription.deviceId)
        .where("endpoint", "not in", newest),
    );
    return ok(subscription);
  },
});

/** Lists every browser push subscription, oldest first. */
export const listWebPushSubscriptionsTask: StoreTask<null, readonly WebPushSubscriptionRecord[]> =
  defineTask({
    name: "access.list_web_push_subscriptions",
    access: "read",
    input: z.null(),
    output: z.array(webPushSubscriptionRecordSchema),
    run(database) {
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      const rows = kysely
        .selectFrom("web_push_subscriptions")
        .selectAll()
        .orderBy("created_at")
        .orderBy("endpoint");
      return execute(rows).rows.map(toSubscription);
    },
  });

/** Drops the subscription at an endpoint, only the named device's when one is named. */
export const dropWebPushSubscriptionTask: StoreTask<
  WebPushDrop,
  Result<WebPushSubscriptionRecord, "not_found">
> = defineTask({
  name: "access.drop_web_push_subscription",
  access: "write",
  input: webPushDropSchema,
  output: resultSchema(webPushSubscriptionRecordSchema, ["not_found"]),
  run(database, drop) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("web_push_subscriptions").selectAll().where("endpoint", "=", drop.endpoint),
    );
    if (row === undefined || (drop.deviceId !== undefined && row.device_id !== drop.deviceId)) {
      return err("not_found");
    }
    execute(kysely.deleteFrom("web_push_subscriptions").where("endpoint", "=", drop.endpoint));
    return ok(toSubscription(row));
  },
});
