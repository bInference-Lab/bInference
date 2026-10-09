import type { AccountRef } from "../caip/account-ref.js";
import type { StepReplacement } from "../signing/sign-step.js";
import type { SignedTx, TxDraft, UnsignedTx } from "../transaction.js";

/** A draft and the nonce the wallet queue gave it. */
export interface PrepareRequest {
  readonly draft: TxDraft;
  readonly nonce: number;
}

/** A draft made ready to sign: its nonce, gas and fees, read from the chain now. */
export interface PreparedTx {
  readonly unsigned: UnsignedTx;
  /** The most the transaction pays per unit of work, in base units of the native coin. */
  readonly feePerGasBase: bigint;
  /**
   * The fee per gas is above the chain's network fee cap: only the owner's tap pays it, never the
   * auto mode (decision 0102).
   */
  readonly isAboveFeeCap: boolean;
}

/**
 * A signed transaction to replace at its nonce (intent-states spec, section 6): `speedUp` repeats
 * its call, `cancel` makes a 0-value transfer to `from` itself.
 */
export interface ReplaceRequest {
  readonly kind: StepReplacement["kind"];
  /** The account that signed it, which signs the replacement too. */
  readonly from: AccountRef;
  /** Its signed bytes, as the wallet queue stored them. */
  readonly replaced: SignedTx;
}

/** A replacement made ready to sign, with what the signer checks it against (keys spec, rule 6). */
export interface PreparedReplacement extends PreparedTx {
  readonly replaces: StepReplacement;
}
