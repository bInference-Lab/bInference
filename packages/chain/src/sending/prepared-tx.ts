import type { TxDraft, UnsignedTx } from "../transaction.js";

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
