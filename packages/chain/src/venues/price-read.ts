import type { Ratio, Result } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import type { AssetRef } from "../caip/asset-ref.js";

/**
 * What the price watcher asks a venue: how to price a token from the chain's state. The venue
 * reads only its own contracts, which the host gives it by their names in the chain registry, as
 * for a quote.
 */
export interface PriceReadRequest {
  /** The token to price, on one of the venue's chains. */
  readonly token: AssetRef;
  /**
   * The venue's declared contracts on the token's chain, by their names in the registry, and the
   * contracts of the token's launch on a launchpad that holds it, by their declared names.
   */
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

/** One read call of a price read: the contract it asks and its input. */
export interface ReadCall {
  /** The contract the call reads, on the token's chain. */
  readonly target: AccountRef;
  /** The call's input in its chain family's own encoding: an EVM call's calldata as hex. */
  readonly input: string;
}

/**
 * What one read call answered at a block: its output in its family's own encoding, an EVM call's
 * return data as hex, or `undefined` when the call failed.
 */
export type ReadAnswer = string | undefined;

/**
 * Why a read's answers priced nothing: `unpriced` for answers that failed or fell outside their
 * shape at that block, which may read again at the next; `replan` for answers that say the read
 * no longer holds, such as a token that left its curve or a pool gone empty, so another read must
 * be found.
 */
export type PriceMiss = "unpriced" | "replan";

/**
 * How a venue prices a token each block: the calls that read the state the price comes from (a
 * pool's reserves or its current price, a curve's reserves or price), and the pure step that turns
 * their answers into the price. The watcher asks every watched token's calls in one batched read
 * per block, so the calls take no block of their own: the watcher reads them all at one block.
 */
export interface PriceRead {
  /** The asset the price is in: the pool's or the curve's other asset. */
  readonly quoteAsset: AssetRef;
  /** The calls to read, at least one, each at the same block. */
  readonly calls: readonly ReadCall[];
  /**
   * The token's price from the calls' answers, in their order: base units of the quote asset for
   * one base unit of the token, exact. Answers that price nothing are a {@link PriceMiss}, never a
   * throw: a call that failed or an answer outside its shape is `unpriced`; a pool with no
   * reserves or a token that left its curve is `replan`.
   */
  readonly price: (answers: readonly ReadAnswer[]) => Result<Ratio, PriceMiss>;
  /**
   * The depth of the pool the read prices from when it was chosen, in micro-dollars of the quote
   * it can trade: a pool under $25,000 needs a recent cross-check before a trigger uses its price
   * (decision 0194). Only the chain family's pool reader gives one; a venue's read carries none.
   */
  readonly depthUsdMicros?: bigint;
}
