import type { AccountRef } from "../caip/account-ref.js";
import type { AssetRef } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { Delivery, DeliveryRequest } from "./delivery.js";

/**
 * Reads what reached an account on one chain, such as a bridge's destination: its holding of an
 * asset now, and what one transaction brought it, so a bridge's delivery is checked against its
 * quote (decision 0067). It only reads. Adapters: the EVM family's over the chain's RPC failover,
 * and Solana's over Solana's JSON-RPC.
 */
export interface DeliveryReader {
  /** The chain it reads. */
  readonly chain: ChainRef;
  /**
   * The account's holding of one asset now, in base units: the chain's native coin or one of its
   * tokens, 0 when it holds none. An account or an asset of another chain, or an asset the
   * family cannot read, is a fault. A node that cannot answer rejects, and so does the signal once
   * it aborts.
   */
  balance(
    account: AccountRef,
    asset: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<bigint>;
  /**
   * What the transaction brought the recipient of the asset, or `undefined` while no block holds
   * it. A recipient or an asset of another chain is a fault; the rest rejects as `balance` does.
   */
  delivery(
    request: DeliveryRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Delivery | undefined>;
}
