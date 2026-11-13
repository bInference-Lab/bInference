import type { RelaySender, Signer } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { IntentStore, PositionStore, TransactionStore } from "../ports.js";
import type { BenchOptions } from "./test-executor.js";

/** A code a store or the signer service throws once the install is another worker's. */
export type LostLeaseCode = "store.lease_lost" | "store.lease_mismatch";

/** The fault a store write or the signer service throws once the lease is gone. */
export function lostLeaseFault(code: LostLeaseCode = "store.lease_lost"): BinferenceError {
  return new BinferenceError({ code, message: "This worker no longer holds the install." });
}

/** Where an intent store finds the lease gone, and whom it tells of each move written after. */
export interface IntentLeaseLoss {
  /** Every move into this state throws the lost lease. */
  readonly state: string;
  /** Whether the loss is armed yet; armed from the start when absent. */
  readonly isArmed?: () => boolean;
  /** Told the state of each other move written once the lease was first lost. */
  readonly noteAfter?: (state: string) => void;
}

/**
 * Wraps an intent store so each move into `loss.state` throws a lost lease while armed, and each
 * other move after the first such throw is told to `loss.noteAfter`, then written.
 */
export function losingLeaseAt(loss: IntentLeaseLoss): (store: IntentStore) => IntentStore {
  const lease = { isLost: false };
  return (store) => ({
    ...store,
    transition: async (change, call) => {
      if ((loss.isArmed?.() ?? true) && change.state === loss.state) {
        lease.isLost = true;
        throw lostLeaseFault();
      }
      if (lease.isLost) {
        loss.noteAfter?.(change.state);
      }
      return store.transition(change, call);
    },
  });
}

/** Where a bench's lease is lost: the call of a store write, a signature or a send that throws. */
export interface LossPoint {
  /** A write such as `transactions.saveSigned`, or `custody.signTransaction`, or `sender.send`. */
  readonly at: string;
  /** Which call of it throws, from 1. */
  readonly call: number;
  readonly code: LostLeaseCode;
}

/**
 * A bench's lease: it is lost at its {@link LossPoint}, and every write, signature and send the
 * executor tries after that is noted in `after`, then passes, so a test sees an end the executor
 * wrote even where a real fence would refuse it.
 */
export interface BenchLease {
  readonly after: readonly string[];
  /** How many times the executor called a write, a signature or a send before the loss. */
  readonly calls: (at: string) => number;
  /** The bench parts that pass every write, signature and send through the lease. */
  readonly options: Pick<
    BenchOptions,
    "custody" | "sender" | "transactions" | "intents" | "positions"
  >;
}

type Note = <T>(at: string, work: () => Promise<T>) => Promise<T>;

// A pass-through of the store whose writes note their calls first.
function notedTransactions(inner: TransactionStore, noted: Note) {
  const wrapped: TransactionStore = {
    ...inner,
    nextNonce: async (request, call) =>
      noted("transactions.nextNonce", async () => inner.nextNonce(request, call)),
    saveSigned: async (signed, call) =>
      noted("transactions.saveSigned", async () => inner.saveSigned(signed, call)),
    saveReplacement: async (signed, call) =>
      noted("transactions.saveReplacement", async () => inner.saveReplacement(signed, call)),
    recordSend: async (send, call) =>
      noted("transactions.recordSend", async () => inner.recordSend(send, call)),
    recordReceipt: async (inclusion, call) =>
      noted("transactions.recordReceipt", async () => inner.recordReceipt(inclusion, call)),
    recordFinal: async (mark, call) =>
      noted("transactions.recordFinal", async () => inner.recordFinal(mark, call)),
    recordDropped: async (mark, call) =>
      noted("transactions.recordDropped", async () => inner.recordDropped(mark, call)),
    recordSuperseded: async (mark, call) =>
      noted("transactions.recordSuperseded", async () => inner.recordSuperseded(mark, call)),
    recordReorg: async (mark, call) =>
      noted("transactions.recordReorg", async () => inner.recordReorg(mark, call)),
  };
  return wrapped;
}

// A pass-through of the store whose writes note their calls first.
function notedIntents(inner: IntentStore, noted: Note) {
  const wrapped: IntentStore = {
    ...inner,
    create: async (draft, call) => noted("intents.create", async () => inner.create(draft, call)),
    transition: async (move, call) =>
      noted("intents.transition", async () => inner.transition(move, call)),
    freeze: async (freeze, call) => noted("intents.freeze", async () => inner.freeze(freeze, call)),
  };
  return wrapped;
}

// A pass-through of the store whose writes note their calls first.
function notedPositions(inner: PositionStore, noted: Note) {
  const wrapped: PositionStore = {
    ...inner,
    record: async (write, call) => noted("positions.record", async () => inner.record(write, call)),
    recordArrival: async (write, call) =>
      noted("positions.recordArrival", async () => inner.recordArrival(write, call)),
    recordDepartures: async (write, call) =>
      noted("positions.recordDepartures", async () => inner.recordDepartures(write, call)),
    resetPaper: async (reset, call) =>
      noted("positions.resetPaper", async () => inner.resetPaper(reset, call)),
  };
  return wrapped;
}

/** Starts a lease that is lost at `loss`. */
export function benchLease(loss: LossPoint): BenchLease {
  const after: string[] = [];
  const counts = new Map<string, number>();
  const state = { lost: false };
  const noted: Note = async (at, work) => {
    if (state.lost) {
      after.push(at);
      return work();
    }
    const count = (counts.get(at) ?? 0) + 1;
    counts.set(at, count);
    if (at === loss.at && count === loss.call) {
      state.lost = true;
      throw lostLeaseFault(loss.code);
    }
    return work();
  };
  const custody = (inner: Signer) => {
    const wrapped: Signer = {
      account: async (wallet, chain, call) => inner.account(wallet, chain, call),
      signTransaction: async (request, call) =>
        noted("custody.signTransaction", async () => inner.signTransaction(request, call)),
    };
    return wrapped;
  };
  const sender = (inner: RelaySender) => {
    const wrapped: RelaySender = {
      relays: inner.relays,
      send: async (transaction, call) =>
        noted("sender.send", async () => inner.send(transaction, call)),
    };
    return wrapped;
  };
  return {
    after,
    calls: (at) => counts.get(at) ?? 0,
    options: {
      custody,
      sender,
      transactions: (inner) => notedTransactions(inner, noted),
      intents: (inner) => notedIntents(inner, noted),
      positions: (inner) => notedPositions(inner, noted),
    },
  };
}
