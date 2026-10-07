import type { AssetRef, PriceSource, UsdPrice } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";

/** A price source for tests that answers from a fixed table and never touches a chain. */
export interface FakePriceSource extends PriceSource {
  /** The assets it was asked to price, oldest first, up to the last 1,000. */
  asked(): readonly AssetRef[];
}

const maxAsked = 1_000;

/**
 * Creates a {@link FakePriceSource}. An asset missing from the table is `no_price`. It keeps the
 * last 1,000 assets it was asked for and drops older ones.
 */
export function createFakePriceSource(prices: ReadonlyMap<AssetRef, UsdPrice>): FakePriceSource {
  const asked: AssetRef[] = [];
  return {
    async usdPrice(asset, options): Promise<Result<UsdPrice, "no_price">> {
      options.signal.throwIfAborted();
      asked.push(asset);
      if (asked.length > maxAsked) {
        asked.shift();
      }
      const price = prices.get(asset);
      return await Promise.resolve(price === undefined ? err("no_price") : ok(price));
    },
    asked: () => [...asked],
  };
}
