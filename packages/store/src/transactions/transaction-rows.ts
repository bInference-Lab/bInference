import type { DatabaseSync } from "node:sqlite";
import { accountRefParts } from "@binference/chain";
import {
  type AccountNonces,
  holdingStates,
  inBlockStates,
  type SignedTransaction,
  type TransactionRecord,
  transactionRecordSchema,
} from "@binference/engine/wallet-queue";
import type { Insertable, Selectable } from "kysely";
import type { EngineTables, TxsTable } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";

/** Reads one `txs` row of a signed transaction as its record. */
export function toTransactionRecord(row: Selectable<TxsTable>): TransactionRecord {
  return transactionRecordSchema.parse({
    id: row.id,
    intentId: row.intent_id,
    step: row.step,
    account: row.account,
    nonce: row.nonce,
    raw: row.raw,
    hash: row.hash,
    signedAtMs: row.signed_at,
    state: row.state,
  });
}

/** The `txs` row of a signed transaction, before any send. */
export function signedRow(transaction: SignedTransaction): Insertable<TxsTable> {
  return {
    id: transaction.id,
    intent_id: transaction.intentId,
    step: transaction.step,
    chain: accountRefParts(transaction.account).chain,
    account: transaction.account,
    nonce: transaction.nonce,
    state: "signed",
    raw: transaction.raw,
    hash: transaction.hash,
    gas_price: null,
    relays: null,
    supersedes: null,
    block_number: null,
    receipt: null,
    signed_at: transaction.signedAtMs,
    sent_at: null,
    included_at: null,
    final_at: null,
  };
}

/**
 * Reads what the lowest free nonce rule needs about one account, inside the task's transaction: the
 * block floor, the nonces of its signed and sent transactions, and one past the highest nonce given.
 */
export function readAccountNonces(database: DatabaseSync, account: string): AccountNonces {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const own = kysely.selectFrom("txs").where("account", "=", account);
  const inBlock = takeFirst(
    own.select((select) => select.fn.max("nonce").as("top")).where("state", "in", inBlockStates),
  );
  const held = execute(own.select("nonce").where("state", "in", holdingStates)).rows;
  const given = takeFirst(
    kysely.selectFrom("nonces").select("next_nonce").where("account", "=", account),
  );
  return {
    blockFloor: (inBlock?.top ?? -1) + 1,
    held: held.map(({ nonce }) => nonce),
    given: given?.next_nonce ?? 0,
  };
}
