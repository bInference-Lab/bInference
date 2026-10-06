import type { AccountRef } from "./caip/account-ref.js";
import type { AssetRef } from "./caip/asset-ref.js";

/** A token allowance a call grants, as the family's own token standard writes it. */
export interface TokenApproval {
  /** The token whose allowance changes: the contract the call goes to. */
  readonly asset: AssetRef;
  /** The account the allowance lets spend the wallet's tokens. */
  readonly spender: AccountRef;
  /** The allowance it sets, in base units of the token. */
  readonly amountBase: bigint;
}

/**
 * What a family reads from a {@link TxDraft} on its own, without knowing the venue that built it:
 * where the call goes, the native coin it sends, and the token approval it grants, if it is one.
 */
export interface DraftCall {
  /** The contract or account the draft calls, on the draft's chain, in canonical form. */
  readonly target: AccountRef;
  /** The native coin sent with the call, in base units. */
  readonly nativeValue: bigint;
  /** Set when the call is the family's standard token approval. */
  readonly approval?: TokenApproval;
}
