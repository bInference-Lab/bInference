import type { Err, Result } from "@binference/core";
import type { AssetRef } from "./caip/asset-ref.js";
import type { ChainRef } from "./caip/chain-ref.js";
import type { SignedTx } from "./transaction.js";

/**
 * What a signer service answered over the user's 24-hour sums (keys spec, section 8.4): the sum
 * the transaction would pass, in its asset's base units, and when enough of the window's
 * reservations age out for it to pass.
 */
export interface DaySumsRefusal {
  readonly chain: ChainRef;
  /** The asset the sum counts: the chain's coin, or a token the chain caps. */
  readonly asset: AssetRef;
  readonly capBase: bigint;
  /** What the window held before this transaction. */
  readonly usedBase: bigint;
  /** What this transaction would add. */
  readonly askedBase: bigint;
  /** When room frees, in epoch milliseconds. */
  readonly roomAtMs: number;
}

/**
 * Why a signer service signs nothing for now (keys spec, section 8.3): its breaker is pulled, its
 * key's read-back does not match, or Privy refused its app secret.
 */
export type SignerLock = "breaker" | "key_check" | "privy_app";

/**
 * The answer to one signing request: the signed transaction; `unknown_wallet` or `refused`; and,
 * from a signer service, `over_sums` with the sum it would pass, or `locked` with why it signs
 * nothing (decision 0425). Each refusal is a decision, which asking again does not change.
 */
export type SignOutcome =
  | Result<SignedTx, "unknown_wallet" | "refused">
  | (Err<"over_sums"> & { readonly sums: DaySumsRefusal })
  | (Err<"locked"> & { readonly lock: SignerLock });
