import type { AccountRef } from "@binference/chain";
import type { Id } from "@binference/core";

/**
 * A wallet a stuck step holds: no later step of its queue signs until a block holds the step or
 * the drop rule drops it (decision 0115).
 */
export interface HeldWallet {
  readonly agent: Id<"agt">;
  readonly account: AccountRef;
}

/** The wallets the executor's watches hold now, by the intent whose step holds each. */
export type HeldWallets = Map<Id<"int">, HeldWallet>;
