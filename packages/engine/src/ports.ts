import type { AssetRef } from "@binference/chain";
import type { Ratio, Result } from "@binference/core";

/**
 * A USD price as micro-dollars per base unit of one asset: `numerator` micro-dollars buy
 * `denominator` base units. A ratio stays exact for a token worth less than a micro-dollar a unit.
 */
export type UsdPrice = Ratio;

/**
 * Gives the USD price of an asset now (decision 0059): a feed for the native coin and stablecoins,
 * the trade's own quote for other tokens. A price is above zero, with a denominator above zero. An
 * asset it cannot price, or a price too old to trust, is `no_price`, never a throw, so the policy
 * refuses the trade.
 */
export interface PriceSource {
  /** The price of one asset. Rejects with the signal's reason once the signal aborts. */
  usdPrice(
    asset: AssetRef,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<UsdPrice, "no_price">>;
}
