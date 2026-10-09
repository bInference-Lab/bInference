import type { Amount } from "./amount.js";
import type { AccountRef } from "./caip/account-ref.js";

/** A transfer to draft: `amount` of the native coin or a token from one account to another. */
export interface TokenTransfer {
  readonly from: AccountRef;
  readonly to: AccountRef;
  readonly amount: Amount;
}
