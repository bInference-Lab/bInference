import type { AssetRef, ReadAnswer } from "@binference/chain";
import type { Ratio } from "@binference/core";
import type { Address } from "viem";
import { feedRoundSchema, latestRoundDataCall } from "../prices/feed-round.schema.js";
import { type FeedAsset, priceFromRound } from "../prices/price-from-round.js";
import type { AggregateCall } from "./read-aggregate.js";

/** The feed reads of one block's batch, and how their answers price the quote assets. */
export interface QuoteFeedReads {
  /** One `latestRoundData` call per feed, each feed once. */
  readonly calls: readonly AggregateCall[];
  /**
   * Each quote asset's USD price from its feed's answer, in micro-dollars per base unit, read at
   * `nowMs`. A quote asset whose feed failed, answered outside its shape, or is stale is left out.
   */
  usdPrices(answers: readonly ReadAnswer[], nowMs: number): ReadonlyMap<AssetRef, Ratio>;
}

/**
 * The reads that price the quote assets of one block's batch from their Chainlink feeds, at the
 * same block as the pools and curves they price against. A quote asset without a feed gets no
 * call and no price.
 */
export function quoteFeedReads(
  feeds: ReadonlyMap<AssetRef, FeedAsset>,
  quotes: Iterable<AssetRef>,
): QuoteFeedReads {
  const priced = [...new Set(quotes)].flatMap((asset) => {
    const feed = feeds.get(asset);
    return feed === undefined ? [] : [feed];
  });
  const addresses: Address[] = [...new Set(priced.map(({ feed }) => feed.address))];
  return {
    calls: addresses.map((target) => ({ target, callData: latestRoundDataCall })),
    usdPrices(answers, nowMs) {
      const rounds = new Map(
        addresses.map((address, index) => [address, feedRoundSchema.safeParse(answers[index])]),
      );
      return new Map(
        priced.flatMap((item) => {
          const round = rounds.get(item.feed.address);
          const price =
            round?.success === true ? priceFromRound(item, round.data, nowMs) : undefined;
          return price?.ok === true ? [[item.asset, price.value] as const] : [];
        }),
      );
    },
  };
}
