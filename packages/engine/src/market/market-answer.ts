/**
 * Why a market read has no answer (spec 1, section 7.3): no source answered anything for it
 * (`no_data`, `market.no_data`), or a source that might have was down (`source_down`,
 * `market.source_down`, worth asking again).
 */
export type MarketReadFailure = "no_data" | "source_down";

/** A market read's answer, and the data source it came from, such as `dexscreener`. */
export interface MarketAnswer<Item> {
  readonly source: string;
  readonly items: readonly Item[];
}
