import type { AccountRef, NonceSource } from "@binference/chain";
import { BinferenceError, type Clock, type Result } from "@binference/core";
import type { TransactionStore } from "../ports.js";
import type { NonceGrant } from "./nonce-grant.js";
import type { SignedTransaction, TransactionRecord } from "./transaction-record.js";

/**
 * A work's turn on one account's wallet queue: the only way to take a nonce and store a signed
 * transaction at it. It closes when the work ends.
 */
export interface WalletSlot {
  /** The account whose queue this slot holds. */
  readonly account: AccountRef;
  /**
   * Takes the account's next nonce by the lowest free nonce rule, from the chain's count read now
   * and the stored transactions. Asking again before a save gives the same nonce.
   */
  nextNonce(options: { readonly signal: AbortSignal }): Promise<NonceGrant>;
  /**
   * Stores a signed transaction at the nonce this slot was last given, before any send; the slot
   * must ask for a nonce again for the next one. `nonce_taken` when the nonce is not free after
   * all. A transaction of another account or at another nonce throws `wallet_queue.not_given`.
   */
  saveSigned(
    transaction: SignedTransaction,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<TransactionRecord, "nonce_taken">>;
}

/** The ports a slot reads the chain's count from and keeps transactions in. */
export interface WalletSlotPorts {
  readonly transactions: TransactionStore;
  readonly nonces: NonceSource;
  readonly clock: Clock;
}

/** A slot and the switch that closes it. */
interface OpenSlot {
  readonly slot: WalletSlot;
  readonly close: () => void;
}

function closedFault(account: AccountRef): BinferenceError {
  return new BinferenceError({
    code: "wallet_queue.slot_closed",
    message: "A work used its wallet queue slot after the work ended.",
    details: { account },
  });
}

function notGivenFault(account: AccountRef, transaction: SignedTransaction): BinferenceError {
  return new BinferenceError({
    code: "wallet_queue.not_given",
    message: "A signed transaction must use the account and nonce its slot was given.",
    details: { account, nonce: transaction.nonce, intent: transaction.intentId },
  });
}

/** Opens the slot of one work on `account`'s queue. */
export function openWalletSlot(account: AccountRef, ports: WalletSlotPorts): OpenSlot {
  let isOpen = true;
  let given: number | undefined;
  const assertOpen = (): void => {
    if (!isOpen) {
      throw closedFault(account);
    }
  };
  const slot: WalletSlot = {
    account,
    async nextNonce({ signal }) {
      assertOpen();
      const chainNonce = await ports.nonces.next(account, { signal });
      const request = { account, chainNonce, atMs: ports.clock.now() };
      const grant = await ports.transactions.nextNonce(request, { signal });
      given = grant.nonce;
      return grant;
    },
    async saveSigned(transaction, { signal }) {
      assertOpen();
      if (transaction.account !== account || transaction.nonce !== given) {
        throw notGivenFault(account, transaction);
      }
      // The grant is spent whatever the store answers: the next transaction asks again.
      given = undefined;
      return ports.transactions.saveSigned(transaction, { signal });
    },
  };
  return {
    slot,
    close: () => {
      isOpen = false;
    },
  };
}
