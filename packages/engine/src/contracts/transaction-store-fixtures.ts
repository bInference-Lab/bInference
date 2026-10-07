import assert from "node:assert/strict";
import { type AccountRef, isTxHash, type TxHash } from "@binference/chain";
import type { Id } from "@binference/core";
import type { TransactionStore } from "../ports.js";
import type { NonceGrant } from "../wallet-queue/nonce-grant.js";
import type {
  SignedTransaction,
  TransactionRecord,
  TransactionState,
} from "../wallet-queue/transaction-record.js";
import { fixtureId, live } from "./store-fixtures.js";

/**
 * A transaction store under test: two intents that exist in its database, two accounts, and a
 * way to move a stored transaction to a later state, as sending, a block or a drop would.
 */
export interface TransactionStoreSubject {
  readonly store: TransactionStore;
  readonly intentIds: readonly [Id<"int">, Id<"int">];
  readonly accounts: readonly [AccountRef, AccountRef];
  setState(id: Id<"tx">, state: TransactionState): Promise<void>;
}

/** The hash of fixture transaction `n`. */
export function hashOf(n: number): TxHash {
  const hash = `0x${n.toString(16).padStart(64, "0")}`;
  assert.ok(isTxHash(hash));
  return hash;
}

/** Transaction `n` of the subject's first account, signed at `nonce`. */
export function signed(
  subject: TransactionStoreSubject,
  n: number,
  nonce: number,
): SignedTransaction {
  return {
    id: fixtureId("tx", n),
    intentId: n % 2 === 0 ? subject.intentIds[0] : subject.intentIds[1],
    step: n,
    account: subject.accounts[0],
    nonce,
    raw: `0x02f8${n.toString(16).padStart(4, "0")}`,
    hash: hashOf(n),
    signedAtMs: 1_000 * n,
  };
}

/** Asks the subject's store for its first account's next nonce. */
export async function grant(
  subject: TransactionStoreSubject,
  chainNonce: number,
): Promise<NonceGrant> {
  return subject.store.nextNonce({ account: subject.accounts[0], chainNonce, atMs: 1 }, live());
}

/** Takes a nonce and stores transaction `n` at it, as the wallet queue does for one step. */
export async function takeAndSave(
  subject: TransactionStoreSubject,
  n: number,
  chainNonce: number,
): Promise<TransactionRecord> {
  const { nonce } = await grant(subject, chainNonce);
  const saved = await subject.store.saveSigned(signed(subject, n, nonce), live());
  assert.ok(saved.ok);
  return saved.value;
}
