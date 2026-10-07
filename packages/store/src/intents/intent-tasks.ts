import { type Id, idSchema, type Result } from "@binference/core";
import {
  type CardRecord,
  cardRecordSchema,
  type IntentChange,
  intentChangeSchema,
  type IntentCommit,
  intentCommitSchema,
  type IntentDraft,
  intentDraftSchema,
  type IntentEventRecord,
  intentEventRecordSchema,
  type IntentQuery,
  intentQuerySchema,
  type IntentRecord,
  intentRecordSchema,
  type StoredConfirmation,
  storedConfirmationSchema,
} from "@binference/engine";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";
import { toCardRecord, toConfirmation, toIntentEvent, toIntentRecord } from "./intent-rows.js";
import { createIntent, moveIntent } from "./intent-writes.js";

const intentId = idSchema("int");

/** Writes a new intent with its first event and ledger entry. */
export const createIntentTask: StoreTask<IntentDraft, Result<IntentCommit, "exists">> = defineTask({
  name: "intents.create",
  access: "write",
  input: intentDraftSchema,
  output: resultSchema(intentCommitSchema, ["exists"]),
  run: (database, draft) => createIntent(database, draft),
});

/** Moves an intent under the version its mover read. */
export const moveIntentTask: StoreTask<
  IntentChange,
  Result<IntentCommit, "not_found" | "stale">
> = defineTask({
  name: "intents.move",
  access: "write",
  input: intentChangeSchema,
  output: resultSchema(intentCommitSchema, ["not_found", "stale"]),
  run: (database, change) => moveIntent(database, change),
});

/** Reads one intent. */
export const getIntentTask: StoreTask<Id<"int">, IntentRecord | undefined> = defineTask({
  name: "intents.get",
  access: "read",
  input: intentId,
  output: intentRecordSchema.optional(),
  run(database, id) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(kysely.selectFrom("intents").selectAll().where("id", "=", id));
    return row === undefined ? undefined : toIntentRecord(row);
  },
});

/** Lists intents by state, the least recently changed first. */
export const listIntentsTask: StoreTask<IntentQuery, readonly IntentRecord[]> = defineTask({
  name: "intents.list",
  access: "read",
  input: intentQuerySchema,
  output: z.array(intentRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const { agentId, isPaper, after } = query;
    let select = kysely
      .selectFrom("intents")
      .selectAll()
      .where("state", "in", [...query.states]);
    if (agentId !== undefined) {
      select = select.where("agent_id", "=", agentId);
    }
    if (isPaper !== undefined) {
      select = select.where("paper", "=", isPaper ? 1 : 0);
    }
    if (after !== undefined) {
      select = select.where((row) =>
        row.or([
          row("changed_at", ">", after.changedAtMs),
          row.and([row("changed_at", "=", after.changedAtMs), row("id", ">", after.id)]),
        ]),
      );
    }
    const ordered = select.orderBy("changed_at").orderBy("id").limit(query.limit);
    return execute(ordered).rows.map(toIntentRecord);
  },
});

/** Reads an intent's events, oldest first. */
export const intentEventsTask: StoreTask<Id<"int">, readonly IntentEventRecord[]> = defineTask({
  name: "intents.events",
  access: "read",
  input: intentId,
  output: z.array(intentEventRecordSchema),
  run(database, id) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const events = kysely.selectFrom("intent_events").selectAll().where("intent_id", "=", id);
    return execute(events.orderBy("id")).rows.map(toIntentEvent);
  },
});

/** Reads an intent's card versions, oldest first. */
export const intentCardsTask: StoreTask<Id<"int">, readonly CardRecord[]> = defineTask({
  name: "intents.cards",
  access: "read",
  input: intentId,
  output: z.array(cardRecordSchema),
  run(database, id) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const cards = kysely.selectFrom("cards").selectAll().where("intent_id", "=", id);
    return execute(cards.orderBy("version")).rows.map(toCardRecord);
  },
});

/** Reads the card version that carries a callback reference; the column is unique. */
export const cardByRefTask: StoreTask<string, CardRecord | undefined> = defineTask({
  name: "intents.cardByRef",
  access: "read",
  input: z.string(),
  output: cardRecordSchema.optional(),
  run(database, callbackRef) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("cards").selectAll().where("callback_ref", "=", callbackRef),
    );
    return row === undefined ? undefined : toCardRecord(row);
  },
});

/** Reads an intent's confirmation. */
export const intentConfirmationTask: StoreTask<
  Id<"int">,
  StoredConfirmation | undefined
> = defineTask({
  name: "intents.confirmation",
  access: "read",
  input: intentId,
  output: storedConfirmationSchema.optional(),
  run(database, id) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("confirmations").selectAll().where("intent_id", "=", id),
    );
    return row === undefined ? undefined : toConfirmation(row);
  },
});

/** Every task of the SQLite intent store. */
export const intentTasks: readonly TaskRunner[] = [
  createIntentTask,
  moveIntentTask,
  getIntentTask,
  listIntentsTask,
  intentEventsTask,
  intentCardsTask,
  intentConfirmationTask,
  cardByRefTask,
];
