import type { DatabaseSync } from "node:sqlite";
import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type DeviceRecord,
  deviceRecordSchema,
  type StampedId,
  stampedIdSchema,
} from "@binference/engine";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { DevicesTable, EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

function toDevice(row: Selectable<DevicesTable>): DeviceRecord {
  return deviceRecordSchema.parse({
    id: row.id,
    label: row.label,
    alg: row.alg,
    publicKey: row.public_key,
    createdAtMs: row.created_at,
    ...field("lastSeenAtMs", row.last_seen_at),
    ...field("revokedAtMs", row.revoked_at),
  });
}

function readDevice(database: DatabaseSync, id: Id<"dev">): Selectable<DevicesTable> | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(kysely.selectFrom("devices").selectAll().where("id", "=", id));
}

type DeviceStamp = Pick<DevicesTable, "last_seen_at" | "revoked_at">;

// Reads the device, applies the stamp to its row and writes both stamp columns back.
function stampDevice(
  database: DatabaseSync,
  id: Id<"dev">,
  stamp: (row: Selectable<DevicesTable>) => DeviceStamp,
): Result<DeviceRecord, "not_found"> {
  const row = readDevice(database, id);
  if (row === undefined) {
    return err("not_found");
  }
  const stamped = stamp(row);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(kysely.updateTable("devices").set(stamped).where("id", "=", id));
  return ok(toDevice({ ...row, ...stamped }));
}

const deviceResult = resultSchema(deviceRecordSchema, ["not_found"]);

/** Saves a newly paired device; an id in use is `exists`. */
export const addDeviceTask: StoreTask<DeviceRecord, Result<DeviceRecord, "exists">> = defineTask({
  name: "access.add_device",
  access: "write",
  input: deviceRecordSchema,
  output: resultSchema(deviceRecordSchema, ["exists"]),
  run(database, device) {
    if (readDevice(database, device.id) !== undefined) {
      return err("exists");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely.insertInto("devices").values({
        id: device.id,
        label: device.label,
        alg: device.alg,
        public_key: device.publicKey,
        created_at: device.createdAtMs,
        last_seen_at: device.lastSeenAtMs ?? null,
        revoked_at: device.revokedAtMs ?? null,
      }),
    );
    return ok(device);
  },
});

/** Reads one device. */
export const findDeviceTask: StoreTask<Id<"dev">, DeviceRecord | undefined> = defineTask({
  name: "access.find_device",
  access: "read",
  input: idSchema("dev"),
  output: deviceRecordSchema.optional(),
  run(database, id) {
    const row = readDevice(database, id);
    return row === undefined ? undefined : toDevice(row);
  },
});

/** Lists every device, oldest first. */
export const listDevicesTask: StoreTask<null, readonly DeviceRecord[]> = defineTask({
  name: "access.list_devices",
  access: "read",
  input: z.null(),
  output: z.array(deviceRecordSchema),
  run(database) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const devices = kysely.selectFrom("devices").selectAll().orderBy("created_at").orderBy("id");
    return execute(devices).rows.map(toDevice);
  },
});

/** Records a successful proof; the last proof only moves forward. */
export const markDeviceSeenTask: StoreTask<
  StampedId<"dev">,
  Result<DeviceRecord, "not_found">
> = defineTask({
  name: "access.mark_device_seen",
  access: "write",
  input: stampedIdSchema("dev"),
  output: deviceResult,
  run: (database, seen) =>
    stampDevice(database, seen.id, (row) => ({
      last_seen_at: Math.max(row.last_seen_at ?? seen.atMs, seen.atMs),
      revoked_at: row.revoked_at,
    })),
});

/** Revokes a device; a second revoke keeps the first time. */
export const revokeDeviceTask: StoreTask<
  StampedId<"dev">,
  Result<DeviceRecord, "not_found">
> = defineTask({
  name: "access.revoke_device",
  access: "write",
  input: stampedIdSchema("dev"),
  output: deviceResult,
  run: (database, revoke) =>
    stampDevice(database, revoke.id, (row) => ({
      last_seen_at: row.last_seen_at,
      revoked_at: row.revoked_at ?? revoke.atMs,
    })),
});
