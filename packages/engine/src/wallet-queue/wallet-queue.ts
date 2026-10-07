import type { AccountRef } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { z } from "zod";
import { createWaitingLine, type WaitingLine } from "./waiting-line.js";
import { openWalletSlot, type WalletSlot, type WalletSlotPorts } from "./wallet-slot.js";

/**
 * The wallet queue (ARCHITECTURE.md rule 6): one queue per account, width 1, which owns the
 * account's nonces. Signing and sending for an account happen only inside a work on its queue.
 */
export interface WalletQueue {
  /**
   * Runs `work` with the account's slot once every work queued on that account before it has
   * ended: one work per account at a time, in arrival order, while other accounts run side by
   * side. It settles as the work does, and the slot closes when the work ends. A work that waits
   * while its signal aborts leaves the queue unrun and rejects with the signal's reason; a queue
   * with `maxWaiting` works waiting refuses one more with `wallet_queue.full`.
   *
   * `account` is the form `Signer.account` gives: two spellings of one account would make two
   * queues. A work that moves an intent checks it again inside its slot (spec 6, `queue_took`),
   * so the check sees every earlier transaction of the wallet. A work must end once its signal
   * aborts: the queue waits for it.
   */
  run<T>(
    account: AccountRef,
    work: (slot: WalletSlot) => Promise<T>,
    options: { readonly signal: AbortSignal },
  ): Promise<T>;
}

/** The ports of the wallet queue, and how many works may wait on one account. */
export interface WalletQueueOptions extends WalletSlotPorts {
  /** Works that may wait behind the running one on one account, at least 1; 128 when absent. */
  readonly maxWaiting?: number;
}

const maxWaitingSchema = z.int().min(1);
const defaultMaxWaiting = 128;

function fullFault(account: AccountRef, waiting: number): BinferenceError {
  return new BinferenceError({
    code: "wallet_queue.full",
    message: "Too many transactions wait on this wallet's queue.",
    retryable: true,
    details: { account, waiting },
  });
}

/**
 * Creates the {@link WalletQueue}. An account has a waiting line only while a work of it runs, so
 * the map holds one entry per busy account, each line at most `maxWaiting` long. The queue keeps
 * nothing of its own across a restart: the store holds every nonce in use, so a new queue on the
 * same store goes on with no nonce used twice and no gap.
 */
export function createWalletQueue(options: WalletQueueOptions): WalletQueue {
  const maxWaiting = options.maxWaiting ?? defaultMaxWaiting;
  if (!maxWaitingSchema.safeParse(maxWaiting).success) {
    throw new BinferenceError({
      code: "wallet_queue.bad_options",
      message: "maxWaiting is a whole number of works, at least 1.",
      details: { maxWaiting },
    });
  }
  const lines = new Map<AccountRef, WaitingLine>();
  const runInSlot = async <T>(account: AccountRef, work: (slot: WalletSlot) => Promise<T>) => {
    const { slot, close } = openWalletSlot(account, options);
    try {
      return await work(slot);
    } finally {
      close();
      if (lines.get(account)?.next() !== true) {
        lines.delete(account);
      }
    }
  };
  return {
    async run(account, work, { signal }) {
      signal.throwIfAborted();
      const line = lines.get(account);
      if (line === undefined) {
        lines.set(account, createWaitingLine());
        return runInSlot(account, work);
      }
      if (line.size() >= maxWaiting) {
        throw fullFault(account, line.size());
      }
      await line.enter(signal);
      // The account stayed a key from the work before to here, so no later work passed this one.
      return runInSlot(account, work);
    },
  };
}
