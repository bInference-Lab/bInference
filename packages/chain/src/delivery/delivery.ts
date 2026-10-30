import type { Amount } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";
import type { AssetRef } from "../caip/asset-ref.js";
import type { TxHash } from "../transaction.js";

/** Which transaction to read, for whom, and in which asset. */
export interface DeliveryRequest {
  readonly hash: TxHash;
  readonly recipient: AccountRef;
  /** The asset the route delivers, which may differ from the one sent. */
  readonly asset: AssetRef;
}

/**
 * What one transaction brought one account of one asset on the chain that holds it, such as a
 * bridge's fill on the destination chain.
 */
export interface Delivery {
  readonly hash: TxHash;
  /** The block that holds it: its number on an EVM chain, its slot where the chain has slots. */
  readonly block: bigint;
  /** Whether the chain's finality rule counts that block final, so no reorg can undo it. */
  readonly final: boolean;
  /** `failed` when it ran and failed: it moved nothing to the account. */
  readonly status: "success" | "failed";
  /**
   * What the account's holding of the asked asset grew by, in base units: 0 for a failed one, or
   * when it brought none of that asset. A holding that shrank reads as 0.
   */
  readonly received: Amount;
}
