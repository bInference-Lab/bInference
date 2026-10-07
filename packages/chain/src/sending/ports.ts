import type { Result } from "@binference/core";
import type { ChainRef } from "../caip/chain-ref.js";
import type { SignedTx, TxHash } from "../transaction.js";
import type { PreparedTx, PrepareRequest } from "./prepared-tx.js";
import type { RelayAnswer } from "./relay-answer.js";
import type { ChainHead, TxReceipt } from "./tx-receipt.js";

/**
 * Gives a transaction draft its nonce, gas and fees, read from the chain's latest state, as the
 * unsigned transaction the signer signs (ARCHITECTURE.md section 7, step 8). Adapters: the EVM
 * family's, with the gas estimated on the chain and the fees of `readFees`.
 */
export interface TxPreparer {
  /**
   * The draft as an unsigned transaction at the nonce. `would_fail` when the chain says it fails
   * now, so no gas can be set for it. A draft of a chain it does not serve is a fault, and a node
   * that cannot answer rejects. Rejects with the signal's reason once the signal aborts.
   */
  prepare(
    request: PrepareRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<PreparedTx, "would_fail">>;
}

/**
 * Sends a signed transaction to every private relay of its chain at once (ARCHITECTURE.md rule 6),
 * never to a public node. Adapters: the EVM family's `eth_sendRawTransaction` to each relay.
 */
export interface RelaySender {
  /** The relays it sends to, by name, in the order its answers come. */
  readonly relays: readonly string[];
  /**
   * Sends the signed bytes to every relay at once and answers each relay's answer, in the order
   * of `relays`, once each relay answered or its wait ended. A relay that times out never delays
   * another: each request starts at once and waits on its own. It never retries; a caller that
   * sends again sends the same bytes. A transaction of a chain it does not serve is a fault.
   * Rejects with the signal's reason once the signal aborts.
   */
  send(
    signed: SignedTx,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly RelayAnswer[]>;
}

/**
 * Reads sent transactions' receipts and a chain's head, so the wallet queue watches each step
 * until it is final. Adapters: the EVM family's, over the chain's RPC failover, with the final
 * block from the chain's finality rule.
 */
export interface ReceiptReader {
  /**
   * The receipt of a transaction, or `undefined` while no block holds it. A chain it does not
   * serve is a fault, and a node that cannot answer rejects. Rejects with the signal's reason once
   * the signal aborts.
   */
  receipt(
    chain: ChainRef,
    hash: TxHash,
    options: { readonly signal: AbortSignal },
  ): Promise<TxReceipt | undefined>;
  /** The chain's head now, with `final` at or below `latest`. Rejects as `receipt` does. */
  head(chain: ChainRef, options: { readonly signal: AbortSignal }): Promise<ChainHead>;
}
