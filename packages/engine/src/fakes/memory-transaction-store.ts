import type { AccountRef } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import type { TransactionStore } from "../ports.js";
import {
  type AccountNonces,
  holdingStates,
  inBlockStates,
  isNonceFree,
  lowestFreeNonce,
} from "../wallet-queue/lowest-free-nonce.js";
import type { NonceGrant, NonceRequest } from "../wallet-queue/nonce-grant.js";
import type {
  SignedTransaction,
  TransactionRecord,
  TransactionState,
} from "../wallet-queue/transaction-record.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/**
 * A transaction store for tests that keeps its rows in memory. A test moves a stored transaction
 * to a later state with `setState`, as sending, a block or a drop would.
 */
export interface MemoryTransactionStore extends TransactionStore {
  /** Moves a stored transaction to `state`; an unknown id throws `store.constraint`. */
  setState(id: Id<"tx">, state: TransactionState): void;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : 1;
}

// What the account's stored transactions say about its nonces; the grant adds what was given.
function heldNonces(
  transactions: readonly TransactionRecord[],
  account: AccountRef,
): Pick<AccountNonces, "blockFloor" | "held"> {
  const own = transactions.filter((transaction) => transaction.account === account);
  const inBlock = own.filter((transaction) => inBlockStates.includes(transaction.state));
  return {
    blockFloor: Math.max(0, ...inBlock.map((transaction) => transaction.nonce + 1)),
    held: own
      .filter((transaction) => holdingStates.includes(transaction.state))
      .map((transaction) => transaction.nonce),
  };
}

/**
 * Creates an empty {@link MemoryTransactionStore}. It keeps every row until it is dropped, checks a
 * whole write before it changes anything, and gives nonces by the same rule as the SQLite store.
 */
export function createMemoryTransactionStore(): MemoryTransactionStore {
  const transactions: TransactionRecord[] = [];
  const given = new Map<AccountRef, number>();
  const nextNonce = (request: NonceRequest): NonceGrant => {
    const before = given.get(request.account) ?? 0;
    const nonces = { ...heldNonces(transactions, request.account), given: before };
    const grant = lowestFreeNonce(request.chainNonce, nonces);
    given.set(request.account, Math.max(before, grant.nonce + 1));
    return grant;
  };
  const saveSigned = (transaction: SignedTransaction): Result<TransactionRecord, "nonce_taken"> => {
    if (!isNonceFree(transaction.nonce, heldNonces(transactions, transaction.account))) {
      return err("nonce_taken");
    }
    if (transactions.some((stored) => stored.id === transaction.id)) {
      throw constraintFault(`the transaction id ${transaction.id} is in use`);
    }
    const record: TransactionRecord = { ...structuredClone(transaction), state: "signed" };
    transactions.push(record);
    return ok(structuredClone(record));
  };
  return {
    nextNonce: async (request, call) => memoryCall(call, () => nextNonce(request)),
    saveSigned: async (transaction, call) => memoryCall(call, () => saveSigned(transaction)),
    list: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          transactions
            .filter(({ account, nonce }) => account === query.account && nonce >= query.fromNonce)
            .toSorted((left, right) => left.nonce - right.nonce || compareIds(left.id, right.id))
            .slice(0, query.limit),
        ),
      ),
    setState(id, state) {
      const index = transactions.findIndex((transaction) => transaction.id === id);
      const stored = transactions[index];
      if (stored === undefined) {
        throw constraintFault(`no transaction has the id ${id}`);
      }
      transactions[index] = { ...stored, state };
    },
  };
}
