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
 * One event a transaction emitted, as its chain family writes it: on an EVM chain a log, its
 * emitting contract, its topics and its data in hex; on Solana a log line of the program that ran,
 * with no topics and the line's text after its prefix, such as a memo.
 */
export interface ChainEvent {
  readonly emitter: AccountRef;
  readonly topics: readonly string[];
  readonly data: string;
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
  /**
   * The events the transaction emitted, in their order, so a bridge can tell its own fill or
   * refund of one deposit from any other payment; none for a failed one.
   */
  readonly events: readonly ChainEvent[];
}
