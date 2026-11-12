import { BinferenceError, err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  holdingStates,
  inBlockStates,
  isNonceFree,
  lowestFreeNonce,
  type NonceGrant,
  nonceGrantSchema,
  type NonceRequest,
  nonceRequestSchema,
  type SignedReplacement,
  signedReplacementSchema,
  type SignedTransaction,
  signedTransactionSchema,
  type TransactionQuery,
  transactionQuerySchema,
  type TransactionRecord,
  transactionRecordSchema,
} from "@binference/engine/wallet-queue";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import {
  readAccountNonces,
  replacementRow,
  signedRow,
  toTransactionRecord,
} from "./transaction-rows.js";

/**
 * Gives an account its next nonce by the lowest free nonce rule, and raises its stored next nonce
 * past the one given, in one transaction.
 */
export const nextNonceTask: StoreTask<NonceRequest, NonceGrant> = defineTask({
  name: "transactions.next_nonce",
  access: "write",
  input: nonceRequestSchema,
  output: nonceGrantSchema,
  run(database, request) {
    const nonces = readAccountNonces(database, request.account);
    const grant = lowestFreeNonce(request.chainNonce, nonces);
    const next = { next_nonce: Math.max(nonces.given, grant.nonce + 1), changed_at: request.atMs };
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .insertInto("nonces")
        .values({ account: request.account, ...next })
        .onConflict((conflict) => conflict.column("account").doUpdateSet(next)),
    );
    return grant;
  },
});

/**
 * Stores a signed transaction at its nonce when the nonce is free. The same save run again, the
 * same intent, step and bytes at the account's nonce, answers the transaction it stored, as its
 * first run did (decision 0413).
 */
export const saveSignedTask: StoreTask<
  SignedTransaction,
  Result<TransactionRecord, "nonce_taken">
> = defineTask({
  name: "transactions.save_signed",
  access: "write",
  input: signedTransactionSchema,
  output: resultSchema(transactionRecordSchema, ["nonce_taken"]),
  run(database, transaction) {
    const replayed = storedSave(database, transaction);
    if (replayed !== undefined) {
      return ok(replayed);
    }
    if (readTransaction(database, transaction.id) !== undefined) {
      throw constraint("A signed transaction takes an id of its own.", transaction.id);
    }
    if (!isNonceFree(transaction.nonce, readAccountNonces(database, transaction.account))) {
      return err("nonce_taken");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.insertInto("txs").values(signedRow(transaction)));
    return ok({ ...transaction, state: "signed" });
  },
});

function constraint(message: string, transaction: Id<"tx">): BinferenceError {
  return new BinferenceError({ code: "store.constraint", message, details: { transaction } });
}

// The transaction stored under an id, read in the task's transaction (decision 0413).
function readTransaction(database: StoreConnection, id: Id<"tx">): TransactionRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("txs").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toTransactionRecord(row);
}

// The step a save stored before at its account's nonce, with its intent, step and bytes, in a
// state that still holds the nonce or a block's; a dropped or superseded row is no longer it.
function storedSave(
  database: StoreConnection,
  transaction: SignedTransaction,
): TransactionRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("txs")
      .selectAll()
      .where("account", "=", transaction.account)
      .where("nonce", "=", transaction.nonce)
      .where("intent_id", "=", transaction.intentId)
      .where("step", "=", transaction.step)
      .where("raw", "=", transaction.raw)
      .where("state", "in", [...holdingStates, ...inBlockStates]),
  );
  return row === undefined ? undefined : toTransactionRecord(row);
}

// The stored transaction a replacement takes the nonce of: one of its own step, at its nonce.
function readReplaced(
  database: StoreConnection,
  replacement: SignedReplacement,
): TransactionRecord {
  const record = readTransaction(database, replacement.replaces.id);
  if (record === undefined || readTransaction(database, replacement.id) !== undefined) {
    throw constraint(
      "A replacement names a stored transaction and an id of its own.",
      replacement.id,
    );
  }
  const { account, intentId, step, nonce } = replacement;
  const isSameStep =
    record.account === account &&
    record.intentId === intentId &&
    record.step === step &&
    record.nonce === nonce;
  if (!isSameStep) {
    throw constraint(
      "A replacement takes the nonce of its own step's transaction.",
      replacement.id,
    );
  }
  return record;
}

/**
 * Stores a stuck step's replacement at the nonce of the signed or sent transaction it replaces,
 * which becomes `superseded`, in one transaction.
 */
export const saveReplacementTask: StoreTask<
  SignedReplacement,
  Result<TransactionRecord, "wrong_state" | "nonce_taken">
> = defineTask({
  name: "transactions.save_replacement",
  access: "write",
  input: signedReplacementSchema,
  output: resultSchema(transactionRecordSchema, ["wrong_state", "nonce_taken"]),
  run(database, replacement) {
    const replaced = readReplaced(database, replacement);
    if (!holdingStates.includes(replaced.state)) {
      return err("wrong_state");
    }
    const nonces = readAccountNonces(database, replacement.account);
    const held = nonces.held.filter((nonce) => nonce !== replaced.nonce);
    if (!isNonceFree(replacement.nonce, { ...nonces, held })) {
      return err("nonce_taken");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.updateTable("txs").set({ state: "superseded" }).where("id", "=", replaced.id));
    execute(kysely.insertInto("txs").values(replacementRow(replacement)));
    return ok({ ...replacement, state: "signed" });
  },
});

/** Lists one account's transactions from a nonce up, by nonce, then by id. */
export const listTransactionsTask: StoreTask<TransactionQuery, readonly TransactionRecord[]> =
  defineTask({
    name: "transactions.list",
    access: "read",
    input: transactionQuerySchema,
    output: z.array(transactionRecordSchema),
    run(database, query) {
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      const rows = execute(
        kysely
          .selectFrom("txs")
          .selectAll()
          .where("account", "=", query.account)
          .where("nonce", ">=", query.fromNonce)
          .orderBy("nonce")
          .orderBy("id")
          .limit(query.limit),
      ).rows;
      return rows.map(toTransactionRecord);
    },
  });

/** Lists one intent's transactions, by step, then by id. */
export const intentTransactionsTask: StoreTask<
  Id<"int">,
  readonly TransactionRecord[]
> = defineTask({
  name: "transactions.of_intent",
  access: "read",
  input: idSchema("int"),
  output: z.array(transactionRecordSchema),
  run(database, intent) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = execute(
      kysely
        .selectFrom("txs")
        .selectAll()
        .where("intent_id", "=", intent)
        .orderBy("step")
        .orderBy("id"),
    ).rows;
    return rows.map(toTransactionRecord);
  },
});
