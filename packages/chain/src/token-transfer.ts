import type { Amount } from "./amount.js";
import type { AccountRef } from "./caip/account-ref.js";

/** An approval to draft: `amountBase` of the token at `token` that `spender` may take from `from`. */
export interface TokenApprovalRequest {
  readonly from: AccountRef;
  readonly token: AccountRef;
  readonly spender: AccountRef;
  readonly amountBase: bigint;
}

/** A transfer to draft: `amount` of the native coin or a token from one account to another. */
export interface TokenTransfer {
  readonly from: AccountRef;
  readonly to: AccountRef;
  readonly amount: Amount;
}
