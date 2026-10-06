import type { Brand } from "@binference/core";
import type { AccountRef } from "./caip/account-ref.js";
import type { ChainRef } from "./caip/chain-ref.js";

/** A transaction's hash as its chain shows it. */
export type TxHash = Brand<string, "TxHash">;

const txHashPattern = /^[-.%a-zA-Z0-9]{1,128}$/;

/** Whether a text fits the id grammar every family's transaction hash fits. */
export function isTxHash(text: string): text is TxHash {
  return txHashPattern.test(text);
}

/** A transaction before signing, built by its chain's family. */
export interface UnsignedTx {
  readonly chain: ChainRef;
  /** The account that signs and pays. */
  readonly from: AccountRef;
  /** The family's own encoding of the transaction; code outside the family never reads it. */
  readonly payload: string;
}

/** A signed transaction, as the family broadcasts it. */
export interface SignedTx {
  readonly chain: ChainRef;
  /** The signed bytes in the family's own encoding. */
  readonly raw: string;
}

/** Why a signed transaction does not match what was asked to be signed. */
export type SignatureProblem = "malformed_signature" | "other_transaction" | "other_signer";
