import type { DatabaseSync } from "node:sqlite";
import type { AmountWire } from "@binference/chain";
import { BinferenceError, jsonValueSchema } from "@binference/core";
import {
  type NoticeDelivery,
  noticeDeliverySchema,
  type NoticeRecord,
  noticeRecordSchema,
} from "@binference/engine/notices";
import { noticeSchema } from "@binference/engine/surfaces";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { NoticesTable, OutboxTable } from "../databases/notice-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, readJson } from "../rows/column-values.js";

// What a notice's outbox row says, in its `target` and `payload` columns: the owner's chat on the
// surface, and the notice to send.
const payloadSchema = z.object({ notice: z.string() });

/** The `target` of a notice's delivery: the owner's chat, looked up when it is sent. */
export const ownerTarget: string = jsonText({ to: "owner" });

/** The `payload` of a notice's delivery: the notice's id. */
export function noticePayload(record: { readonly id: string }): string {
  return jsonText({ notice: record.id });
}

/** The notice id a delivery's `payload` names. */
export function noticeIdOf(row: { readonly payload: string }): string {
  return payloadSchema.parse(readJson(row.payload)).notice;
}

/**
 * A notice's message arguments as its `values` column keeps them: the plain values, the times, the
 * amounts with each one's base units as decimal text, the parts, and the messages that follow it.
 */
export function argumentsText(record: NoticeRecord): string {
  const { values, times, amounts, parts, after } = z.encode(noticeSchema, record.notice);
  const amountTexts = Object.entries(amounts ?? {}).map(
    ([name, { asset, base }]: readonly [string, AmountWire]) => [name, { asset, base }] as const,
  );
  return jsonText({
    values,
    ...(times === undefined ? {} : { times }),
    ...(amounts === undefined ? {} : { amounts: Object.fromEntries(amountTexts) }),
    ...(parts === undefined ? {} : { parts: jsonValueSchema.parse(parts) }),
    ...(after === undefined ? {} : { after: jsonValueSchema.parse(after) }),
  });
}

// A notice row as its record's schema reads it: amounts still as decimal text.
function recordFieldsOf(row: Selectable<NoticesTable>) {
  const notice = {
    key: row.i18n_key,
    ...field("agent", row.agent_id),
    ...field("intent", row.intent_id),
    ...z.record(z.string(), z.unknown()).parse(readJson(row.values)),
  };
  return {
    id: row.id,
    atMs: row.at,
    notice,
    kind: row.kind,
    level: row.level,
    delivered: readJson(row.delivered),
  };
}

/** Reads a notice row back into its record. */
export function toNoticeRecord(row: Selectable<NoticesTable>): NoticeRecord {
  return noticeRecordSchema.parse(recordFieldsOf(row));
}

function findNoticeRow(database: DatabaseSync, id: string) {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(kysely.selectFrom("notices").selectAll().where("id", "=", id));
}

/** Reads one notice by id, or nothing. */
export function findNotice(database: DatabaseSync, id: string): NoticeRecord | undefined {
  const row = findNoticeRow(database, id);
  return row === undefined ? undefined : toNoticeRecord(row);
}

/** Reads an outbox row with its notice into a delivery; a row without its notice is a fault. */
export function toNoticeDelivery(
  database: DatabaseSync,
  row: Selectable<OutboxTable>,
): NoticeDelivery {
  const notice = findNoticeRow(database, noticeIdOf(row));
  if (notice === undefined) {
    throw new BinferenceError({
      code: "store.constraint",
      message: "An outbox row names a notice the store does not hold.",
      details: { delivery: row.id },
    });
  }
  return noticeDeliverySchema.parse({
    id: row.id,
    surface: row.surface,
    state: row.state,
    attempts: row.attempts,
    nextAtMs: row.next_at ?? row.created_at,
    record: recordFieldsOf(notice),
  });
}
