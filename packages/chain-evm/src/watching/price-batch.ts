import type { AssetRef, PriceMiss, ReadAnswer } from "@binference/chain";
import { err, type Ratio, type Result } from "@binference/core";
import type { QuoteFeedReads } from "./quote-feeds.js";
import type { ReadOutcome } from "./watch-entry.js";
import type { PlannedToken } from "./watch-list.js";

/** A token's price the watcher read at one block. */
export interface WatchedPrice {
  readonly token: AssetRef;
  /** The block whose state priced it. */
  readonly block: bigint;
  /** When the watcher read it, by its clock. */
  readonly atMs: number;
  /** Who priced it: the venue whose reads it asked, or the pools the chain family reads. */
  readonly source: string;
  readonly quoteAsset: AssetRef;
  /** Base units of the quote asset for one base unit of the token, exact. */
  readonly quotePrice: Ratio;
  /**
   * Micro-dollars for one base unit of the token, exact: the quote price times the quote asset's
   * Chainlink price at the same block. Absent when the quote asset has no usable feed.
   */
  readonly usdPrice?: Ratio;
}

/** One block's batch as read: each planned token with its answers, and the quote feeds'. */
export interface BlockRead {
  readonly block: bigint;
  readonly tokens: readonly {
    readonly planned: PlannedToken;
    readonly answers: readonly ReadAnswer[];
  }[];
  readonly feeds: QuoteFeedReads;
  readonly feedAnswers: readonly ReadAnswer[];
}

/** What one block's read came to for one token: the outcome of its plan, and its price. */
export interface TokenRead {
  readonly token: AssetRef;
  readonly outcome: ReadOutcome;
  readonly price?: WatchedPrice;
}

function gcd(left: bigint, right: bigint): bigint {
  return right === 0n ? left : gcd(right, left % right);
}

function times(left: Ratio, right: Ratio): Ratio {
  const numerator = left.numerator * right.numerator;
  const denominator = left.denominator * right.denominator;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function priceOf(planned: PlannedToken, answers: readonly ReadAnswer[]): Result<Ratio, PriceMiss> {
  try {
    return planned.price(answers);
  } catch {
    return err("unpriced");
  }
}

/**
 * Prices every token of one block's read at `atMs`: in its quote asset by its own pricing step,
 * and in USD by its quote asset's feed at the same block. A pricing step that throws prices
 * nothing.
 */
export function pricesOf(read: BlockRead, atMs: number): readonly TokenRead[] {
  const usd = read.feeds.usdPrices(read.feedAnswers, atMs);
  return read.tokens.map(({ planned, answers }) => {
    const { token, source, quoteAsset } = planned;
    const price = priceOf(planned, answers);
    if (!price.ok) {
      return { token, outcome: price.error };
    }
    const quoteUsd = usd.get(quoteAsset);
    const watched: WatchedPrice = {
      token,
      block: read.block,
      atMs,
      source,
      quoteAsset,
      quotePrice: price.value,
      ...(quoteUsd === undefined ? {} : { usdPrice: times(price.value, quoteUsd) }),
    };
    return { token, outcome: "priced", price: watched };
  });
}
