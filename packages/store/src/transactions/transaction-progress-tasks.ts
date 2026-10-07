import type { DatabaseSync } from "node:sqlite";
import { type RelayAnswer, relayAnswerSchema, txReceiptSchema } from "@binference/chain";
import {
  BinferenceError,
  err,
  type Id,
  idSchema,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import {
  progressedState,
  type TransactionInclusion,
  transactionInclusionSchema,
  type TransactionMark,
  transactionMarkSchema,
  type TransactionProgress,
  type TransactionRecord,
  transactionRecordSchema,
  type TransactionSend,
  transactionSendSchema,
  type TransactionState,
} from "@binference/engine/wallet-queue";
import type { Updateable } from "kysely";
import { z } from "zod";
import type { EngineTables, TxsTable } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { toTransactionRecord } from "./transaction-rows.js";

type Moved = Result<TransactionRecord, "wrong_state">;

const movedSchema = resultSchema(transactionRecordSchema, ["wrong_state"]);

function readStored(database: DatabaseSync, id: Id<"tx">): TransactionRecord {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("txs").selectAll().where("id", "=", id));
  if (row === undefined) {
    throw new BinferenceError({
      code: "store.constraint",
      message: `No stored transaction has the id ${id}.`,
      details: { transaction: id },
    });
  }
  return toTransactionRecord(row);
}

// Reads the transaction, checks the move against the rule, and writes the row's new columns.
function move(
  database: DatabaseSync,
  id: Id<"tx">,
  change: {
    readonly progress: TransactionProgress;
    readonly columns: (stored: TransactionRecord) => Updateable<TxsTable>;
  },
): Moved {
  const stored = readStored(database, id);
  const state: TransactionState | undefined = progressedState(stored.state, change.progress);
  if (state === undefined) {
    return err("wrong_state");
  }
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .updateTable("txs")
      .set({ ...change.columns(stored), state })
      .where("id", "=", id),
  );
  return ok(readStored(database, id));
}

function insertAnswers(database: DatabaseSync, send: TransactionSend): void {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const last = takeFirst(
    kysely
      .selectFrom("tx_sends")
      .select((select) => select.fn.max("attempt").as("top"))
      .where("tx_id", "=", send.id),
  );
  const attempt = (last?.top ?? -1) + 1;
  const rows = send.answers.map((answer, place) => ({
    tx_id: send.id,
    attempt,
    place,
    relay: answer.relay,
    outcome: answer.outcome,
    reason: answer.outcome === "refused" ? answer.reason : null,
    code: answer.outcome === "refused" ? (answer.code ?? null) : null,
    at: answer.atMs,
  }));
  execute(kysely.insertInto("tx_sends").values(rows));
}

/**
 * Stores each relay's answer to one send, as the send's next attempt, and moves a `signed`
 * transaction to `sent` once a relay accepted it. Its first send names its relays.
 */
export const recordSendTask: StoreTask<TransactionSend, Moved> = defineTask({
  name: "transactions.record_send",
  access: "write",
  input: transactionSendSchema,
  output: movedSchema,
  run(database, send) {
    const accepted = send.answers.find((answer) => answer.outcome === "accepted");
    const moved = move(database, send.id, {
      progress: { kind: "send", accepted: accepted !== undefined },
      columns: (stored) => ({
        ...(stored.relays === undefined
          ? { relays: jsonText(send.answers.map(({ relay }) => relay)) }
          : {}),
        ...(stored.sentAtMs === undefined && accepted !== undefined
          ? { sent_at: accepted.atMs }
          : {}),
      }),
    });
    if (moved.ok) {
      insertAnswers(database, send);
    }
    return moved;
  },
});

/** Lists a transaction's relay answers, send by send, each send in its relays' order. */
export const listSendsTask: StoreTask<Id<"tx">, readonly RelayAnswer[]> = defineTask({
  name: "transactions.list_sends",
  access: "read",
  input: idSchema("tx"),
  output: z.array(relayAnswerSchema),
  run(database, id) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = execute(
      kysely
        .selectFrom("tx_sends")
        .selectAll()
        .where("tx_id", "=", id)
        .orderBy("attempt")
        .orderBy("place"),
    ).rows;
    return rows.map((row) =>
      relayAnswerSchema.parse({
        relay: row.relay,
        outcome: row.outcome,
        atMs: row.at,
        ...(row.reason === null ? {} : { reason: row.reason }),
        ...(row.code === null ? {} : { code: row.code }),
      }),
    );
  },
});

/** Stores a transaction's receipt: `included`, or `reverted` for status 0, with its block. */
export const recordReceiptTask: StoreTask<TransactionInclusion, Moved> = defineTask({
  name: "transactions.record_receipt",
  access: "write",
  input: transactionInclusionSchema,
  output: movedSchema,
  run(database, { id, receipt, atMs }) {
    return move(database, id, {
      progress: { kind: "receipt", status: receipt.status },
      columns: () => ({
        // Block numbers stay far below 2^53, so the INTEGER column holds them exactly.
        block_number: z.coerce.number().pipe(z.int().nonnegative()).parse(receipt.block.number),
        receipt: jsonText(jsonValueSchema.parse(z.encode(txReceiptSchema, receipt))),
        included_at: atMs,
      }),
    });
  },
});

/** Marks an included transaction `final`. */
export const recordFinalTask: StoreTask<TransactionMark, Moved> = defineTask({
  name: "transactions.record_final",
  access: "write",
  input: transactionMarkSchema,
  output: movedSchema,
  run(database, { id, atMs }) {
    return move(database, id, { progress: { kind: "final" }, columns: () => ({ final_at: atMs }) });
  },
});

/** Moves an included or reverted transaction back to `sent`, without its block and receipt. */
export const recordReorgTask: StoreTask<TransactionMark, Moved> = defineTask({
  name: "transactions.record_reorg",
  access: "write",
  input: transactionMarkSchema,
  output: movedSchema,
  run(database, { id }) {
    return move(database, id, {
      progress: { kind: "reorg" },
      columns: () => ({ block_number: null, receipt: null, included_at: null }),
    });
  },
});
