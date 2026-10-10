import type { DatabaseSync } from "node:sqlite";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import {
  type DeliveryMove,
  deliveryMoveSchema,
  type NoticeDelivery,
  noticeDeliverySchema,
  type NoticePage,
  noticePageSchema,
  type NoticeRecord,
  noticeRecordSchema,
  type QueuedQuery,
  queuedQuerySchema,
} from "@binference/engine/notices";
import type { Selectable, Updateable } from "kysely";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { OutboxTable } from "../databases/notice-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText, orNull } from "../rows/column-values.js";
import { changedRows, rowCountSchema, timeInputSchema } from "../tasks/count-schema.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";
import {
  argumentsText,
  findNotice,
  noticeIdOf,
  noticePayload,
  ownerTarget,
  toNoticeDelivery,
  toNoticeRecord,
} from "./notice-rows.js";

function refused(message: string, details: Readonly<Record<string, string>>): BinferenceError {
  return new BinferenceError({ code: "store.constraint", message, details });
}

// The rows that decide a record: the notice's id is free and its agent is stored.
function checkRecord(database: DatabaseSync, record: NoticeRecord): void {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  if (findNotice(database, record.id) !== undefined) {
    throw refused("A notice with this id is stored.", { notice: record.id });
  }
  const agent = record.notice.agent;
  const held =
    agent === undefined ||
    takeFirst(kysely.selectFrom("agents").select("id").where("id", "=", agent)) !== undefined;
  if (!held) {
    throw refused("A notice names an agent the store does not hold.", { notice: record.id });
  }
}

/** Stores a notice and a delivery for each surface it names, in the state it names. */
export const recordNoticeTask: StoreTask<NoticeRecord, void> = defineTask({
  name: "notices.record",
  access: "write",
  input: noticeRecordSchema,
  output: z.undefined(),
  run(database, record) {
    checkRecord(database, record);
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely.insertInto("notices").values({
        id: record.id,
        agent_id: orNull(record.notice.agent),
        intent_id: orNull(record.notice.intent),
        kind: record.kind,
        i18n_key: record.notice.key,
        values: argumentsText(record),
        level: record.level,
        at: record.atMs,
        delivered: jsonText({ ...record.delivered }),
      }),
    );
    for (const [surface, state] of Object.entries(record.delivered)) {
      execute(
        kysely.insertInto("outbox").values({
          surface,
          target: ownerTarget,
          payload: noticePayload(record),
          state,
          attempts: 0,
          next_at: record.atMs,
          ref: null,
          created_at: record.atMs,
          sent_at: null,
        }),
      );
    }
    return undefined;
  },
});

/** Lists the notices recorded after a cursor, in id order. */
export const listNoticesTask: StoreTask<NoticePage, readonly NoticeRecord[]> = defineTask({
  name: "notices.list",
  access: "read",
  input: noticePageSchema,
  output: z.array(noticeRecordSchema),
  run(database, page) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const all = kysely.selectFrom("notices").selectAll();
    const after = page.after === undefined ? all : all.where("id", ">", page.after);
    return execute(after.orderBy("id").limit(page.limit)).rows.map(toNoticeRecord);
  },
});

/** Lists the queued deliveries to one surface, in the order they were stored. */
export const queuedDeliveriesTask: StoreTask<QueuedQuery, readonly NoticeDelivery[]> = defineTask({
  name: "notices.queued",
  access: "read",
  input: queuedQuerySchema,
  output: z.array(noticeDeliverySchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = kysely
      .selectFrom("outbox")
      .selectAll()
      .where("surface", "=", query.surface)
      .where("state", "=", "queued");
    return execute(rows.orderBy("id").limit(query.limit)).rows.map((row) =>
      toNoticeDelivery(database, row),
    );
  },
});

function changeOf(move: DeliveryMove, row: Selectable<OutboxTable>): Updateable<OutboxTable> {
  if (move.to === "unknown_after_send") {
    return { state: move.to, attempts: row.attempts + 1 };
  }
  if (move.to === "sent") {
    return { state: move.to, sent_at: move.atMs };
  }
  return move.to === "queued" ? { state: move.to, next_at: move.nextAtMs } : { state: move.to };
}

// The notice's `delivered` with the surface's new state, written in the same transaction.
function deliveredAfter(database: DatabaseSync, row: Selectable<OutboxTable>, state: string) {
  const record = findNotice(database, noticeIdOf(row));
  return record === undefined
    ? undefined
    : { id: record.id, delivered: jsonText({ ...record.delivered, [row.surface]: state }) };
}

/** Moves a delivery from the state its mover read, with its notice's `delivered`. */
export const moveDeliveryTask: StoreTask<
  DeliveryMove,
  Result<NoticeDelivery, "not_found" | "moved">
> = defineTask({
  name: "notices.move",
  access: "write",
  input: deliveryMoveSchema,
  output: resultSchema(noticeDeliverySchema, ["not_found", "moved"]),
  run(database, move) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(kysely.selectFrom("outbox").selectAll().where("id", "=", move.id));
    if (row === undefined) {
      return err("not_found");
    }
    if (row.state !== move.from) {
      return err("moved");
    }
    const notice = deliveredAfter(database, row, move.to);
    const change = changeOf(move, row);
    execute(kysely.updateTable("outbox").set(change).where("id", "=", row.id));
    if (notice !== undefined) {
      execute(
        kysely
          .updateTable("notices")
          .set({ delivered: notice.delivered })
          .where("id", "=", notice.id),
      );
    }
    const moved = takeFirst(kysely.selectFrom("outbox").selectAll().where("id", "=", row.id));
    return moved === undefined ? err("not_found") : ok(toNoticeDelivery(database, moved));
  },
});

// How many deliveries one delete names, well within SQLite's limit on bound values.
const pruneChunk = 500;

/** Deletes the notices recorded before a time, with their deliveries. */
export const pruneNoticesTask: StoreTask<number, number> = defineTask({
  name: "notices.prune",
  access: "write",
  input: timeInputSchema,
  output: rowCountSchema,
  run(database, beforeMs) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const old = execute(kysely.selectFrom("notices").select("id").where("at", "<", beforeMs));
    const payloads = old.rows.map((row) => noticePayload(row));
    for (let at = 0; at < payloads.length; at += pruneChunk) {
      const chunk = payloads.slice(at, at + pruneChunk);
      execute(kysely.deleteFrom("outbox").where("payload", "in", chunk));
    }
    return changedRows(execute(kysely.deleteFrom("notices").where("at", "<", beforeMs)));
  },
});

/** Every task of the SQLite notice store. */
export const noticeTasks: readonly TaskRunner[] = [
  recordNoticeTask,
  listNoticesTask,
  queuedDeliveriesTask,
  moveDeliveryTask,
  pruneNoticesTask,
];
