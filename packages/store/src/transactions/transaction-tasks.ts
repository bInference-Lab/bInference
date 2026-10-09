import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  isNonceFree,
  lowestFreeNonce,
  type NonceGrant,
  nonceGrantSchema,
  type NonceRequest,
  nonceRequestSchema,
  type SignedTransaction,
  signedTransactionSchema,
  type TransactionQuery,
  transactionQuerySchema,
  type TransactionRecord,
  transactionRecordSchema,
} from "@binference/engine/wallet-queue";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { readAccountNonces, signedRow, toTransactionRecord } from "./transaction-rows.js";

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

/** Stores a signed transaction at its nonce when the nonce is free. */
export const saveSignedTask: StoreTask<
  SignedTransaction,
  Result<TransactionRecord, "nonce_taken">
> = defineTask({
  name: "transactions.save_signed",
  access: "write",
  input: signedTransactionSchema,
  output: resultSchema(transactionRecordSchema, ["nonce_taken"]),
  run(database, transaction) {
    if (!isNonceFree(transaction.nonce, readAccountNonces(database, transaction.account))) {
      return err("nonce_taken");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.insertInto("txs").values(signedRow(transaction)));
    return ok({ ...transaction, state: "signed" });
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
