import type { AccountRef, RelayAnswer } from "@binference/chain";
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
import {
  progressedState,
  type TransactionInclusion,
  type TransactionMark,
  type TransactionProgress,
  type TransactionSend,
} from "../wallet-queue/transaction-progress.js";
import type {
  SignedTransaction,
  TransactionQuery,
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

/** The rows of a memory transaction store, and the only ways to change them. */
interface MemoryRows {
  /** Every stored transaction, in the order stored. */
  readonly all: () => readonly TransactionRecord[];
  readonly add: (record: TransactionRecord) => void;
  /** Replaces the stored transaction with the record's id. */
  readonly replace: (record: TransactionRecord) => void;
  readonly answersOf: (id: Id<"tx">) => readonly RelayAnswer[];
  readonly addAnswers: (id: Id<"tx">, answers: readonly RelayAnswer[]) => void;
}

function createRows(): MemoryRows {
  const transactions: TransactionRecord[] = [];
  const answers = new Map<Id<"tx">, readonly RelayAnswer[]>();
  return {
    all: () => transactions,
    add(record) {
      transactions.push(record);
    },
    replace(record) {
      const index = transactions.findIndex((transaction) => transaction.id === record.id);
      transactions.splice(index, 1, record);
    },
    answersOf: (id) => answers.get(id) ?? [],
    addAnswers(id, added) {
      answers.set(id, [...(answers.get(id) ?? []), ...added]);
    },
  };
}

// Moves one stored transaction as the progress allows, writing the fields the move brings.
function progress(
  rows: MemoryRows,
  id: Id<"tx">,
  change: {
    readonly progress: TransactionProgress;
    /** The record after the move, but for its state. */
    readonly next: (stored: TransactionRecord) => TransactionRecord;
  },
): Result<TransactionRecord, "wrong_state"> {
  const stored = rows.all().find((transaction) => transaction.id === id);
  if (stored === undefined) {
    throw constraintFault(`no transaction has the id ${id}`);
  }
  const state = progressedState(stored.state, change.progress);
  if (state === undefined) {
    return err("wrong_state");
  }
  const moved: TransactionRecord = { ...change.next(stored), state };
  rows.replace(moved);
  return ok(structuredClone(moved));
}

function recordSend(rows: MemoryRows, send: TransactionSend) {
  const accepted = send.answers.find((answer) => answer.outcome === "accepted");
  const moved = progress(rows, send.id, {
    progress: { kind: "send", accepted: accepted !== undefined },
    next: (stored) => ({
      ...stored,
      relays: stored.relays ?? send.answers.map(({ relay }) => relay),
      ...(stored.sentAtMs === undefined && accepted !== undefined
        ? { sentAtMs: accepted.atMs }
        : {}),
    }),
  });
  if (moved.ok) {
    rows.addAnswers(send.id, send.answers);
  }
  return moved;
}

function recordReceipt(rows: MemoryRows, inclusion: TransactionInclusion) {
  const { receipt, atMs } = inclusion;
  return progress(rows, inclusion.id, {
    progress: { kind: "receipt", status: receipt.status },
    next: (stored) => ({ ...stored, receipt, includedAtMs: atMs }),
  });
}

function recordReorg(rows: MemoryRows, mark: TransactionMark) {
  return progress(rows, mark.id, {
    progress: { kind: "reorg" },
    next: ({ receipt: _receipt, includedAtMs: _includedAtMs, ...kept }) => kept,
  });
}

function nextNonceOf(
  rows: MemoryRows,
  given: Map<AccountRef, number>,
  request: NonceRequest,
): NonceGrant {
  const before = given.get(request.account) ?? 0;
  const nonces = { ...heldNonces(rows.all(), request.account), given: before };
  const grant = lowestFreeNonce(request.chainNonce, nonces);
  given.set(request.account, Math.max(before, grant.nonce + 1));
  return grant;
}

function saveSigned(
  rows: MemoryRows,
  transaction: SignedTransaction,
): Result<TransactionRecord, "nonce_taken"> {
  if (!isNonceFree(transaction.nonce, heldNonces(rows.all(), transaction.account))) {
    return err("nonce_taken");
  }
  if (rows.all().some((stored) => stored.id === transaction.id)) {
    throw constraintFault(`the transaction id ${transaction.id} is in use`);
  }
  const record: TransactionRecord = { ...structuredClone(transaction), state: "signed" };
  rows.add(record);
  return ok(structuredClone(record));
}

function listOf(rows: MemoryRows, query: TransactionQuery): readonly TransactionRecord[] {
  return structuredClone(
    rows
      .all()
      .filter(({ account, nonce }) => account === query.account && nonce >= query.fromNonce)
      .toSorted((left, right) => left.nonce - right.nonce || compareIds(left.id, right.id))
      .slice(0, query.limit),
  );
}

function ofIntent(rows: MemoryRows, intent: Id<"int">): readonly TransactionRecord[] {
  return structuredClone(
    rows
      .all()
      .filter(({ intentId }) => intentId === intent)
      .toSorted((left, right) => left.step - right.step || compareIds(left.id, right.id)),
  );
}

/**
 * Creates an empty {@link MemoryTransactionStore}. It keeps every row until it is dropped, checks a
 * whole write before it changes anything, and gives nonces by the same rule as the SQLite store.
 */
export function createMemoryTransactionStore(): MemoryTransactionStore {
  const rows = createRows();
  const given = new Map<AccountRef, number>();
  return {
    nextNonce: async (request, call) => memoryCall(call, () => nextNonceOf(rows, given, request)),
    saveSigned: async (transaction, call) => memoryCall(call, () => saveSigned(rows, transaction)),
    list: async (query, call) => memoryCall(call, () => listOf(rows, query)),
    ofIntent: async (intent, call) => memoryCall(call, () => ofIntent(rows, intent)),
    recordSend: async (send, call) => memoryCall(call, () => recordSend(rows, send)),
    sends: async (id, call) => memoryCall(call, () => structuredClone(rows.answersOf(id))),
    recordReceipt: async (inclusion, call) =>
      memoryCall(call, () => recordReceipt(rows, inclusion)),
    recordFinal: async (mark, call) =>
      memoryCall(call, () =>
        progress(rows, mark.id, {
          progress: { kind: "final" },
          next: (stored) => ({ ...stored, finalAtMs: mark.atMs }),
        }),
      ),
    recordReorg: async (mark, call) => memoryCall(call, () => recordReorg(rows, mark)),
    setState(id, state) {
      const stored = rows.all().find((transaction) => transaction.id === id);
      if (stored === undefined) {
        throw constraintFault(`no transaction has the id ${id}`);
      }
      rows.replace({ ...stored, state });
    },
  };
}
