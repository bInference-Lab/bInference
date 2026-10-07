import type { NonceGrant } from "./nonce-grant.js";
import type { TransactionState } from "./transaction-record.js";

/** The states in which a transaction may still use its nonce on chain before a block holds it. */
export const holdingStates: readonly TransactionState[] = ["signed", "sent"];

/** The states of a transaction a block holds: its nonce, and every one below, are used on chain. */
export const inBlockStates: readonly TransactionState[] = ["included", "final", "reverted"];

/** What the store knows of one account's nonces, read in the transaction that decides on one. */
export interface AccountNonces {
  /**
   * One past the highest nonce of the account's transactions a block holds (`included`, `final`
   * or `reverted`), or 0 when none does. Every nonce below it is used on chain.
   */
  readonly blockFloor: number;
  /** The nonces the account's `signed` and `sent` transactions hold, in any order. */
  readonly held: readonly number[];
  /** One past the highest nonce the queue gave the account, or 0 before the first. */
  readonly given: number;
}

/**
 * The lowest free nonce rule: the wallet queue gives the lowest nonce at or above both the chain's
 * count and the block floor that no `signed` or `sent` transaction of the account holds. A nonce
 * given to a step that was never signed (a stop, a refusal, a crash) or held by a transaction that
 * was dropped is free again, so the next step takes it and leaves no gap behind.
 */
export function lowestFreeNonce(chainNonce: number, nonces: AccountNonces): NonceGrant {
  const start = Math.max(chainNonce, nonces.blockFloor);
  const above = [...new Set(nonces.held)]
    .filter((nonce) => nonce >= start)
    .toSorted((left, right) => left - right);
  const gap = above.findIndex((nonce, index) => nonce !== start + index);
  const nonce = start + (gap === -1 ? above.length : gap);
  return { nonce, refillsGap: nonce < nonces.given };
}

/**
 * Whether a transaction may be stored at `nonce`: no block holds it or a later nonce of the
 * account, and no `signed` or `sent` transaction of the account holds it.
 */
export function isNonceFree(
  nonce: number,
  nonces: Pick<AccountNonces, "blockFloor" | "held">,
): boolean {
  return nonce >= nonces.blockFloor && !nonces.held.includes(nonce);
}
