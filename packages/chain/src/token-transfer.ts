import type { Amount } from "./amount.js";
import type { AccountRef } from "./caip/account-ref.js";

/** A token transfer to draft: `amount` of a token from one account to another. */
export interface TokenTransfer {
  readonly from: AccountRef;
  readonly to: AccountRef;
  readonly amount: Amount;
}
