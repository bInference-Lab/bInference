import {
  type AccountRef,
  type AssetRef,
  assetRefParts,
  type ChainRef,
  type ChainRegistry,
  type PriceSource,
} from "@binference/chain";
import type { StakePool } from "@binference/chain/staking";
import { err, ok } from "@binference/core";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { isUsablePrice } from "../positions/value-execution.js";
import type { StakingHost } from "../venues/staking-host.js";

/** A receipt token a staking venue mints, its validator and its pool at the latest block. */
export interface HeldPool {
  readonly venue: string;
  readonly validator: AccountRef;
  readonly pool: StakePool;
}

/** The pools of the receipt tokens held, and a price source that prices them by their pool. */
export interface StakePrices {
  readonly pools: ReadonlyMap<AssetRef, HeldPool>;
  readonly prices: PriceSource;
}

/** What receipt tokens are found and priced through: the venues, the registry, the prices. */
export interface StakePriceParts {
  readonly staking: StakingHost;
  readonly chains: ChainRegistry;
  readonly prices: PriceSource;
}

// The held assets of each chain the registry lists no info of: a receipt token is never a registry
// token or a chain's coin.
function unlistedByChain(
  chains: ChainRegistry,
  held: readonly AssetRef[],
): ReadonlyMap<ChainRef, readonly AssetRef[]> {
  const byChain = new Map<ChainRef, AssetRef[]>();
  for (const asset of new Set(held)) {
    if (assetInfoOf(chains, asset) === undefined) {
      const { chain } = assetRefParts(asset);
      byChain.set(chain, [...(byChain.get(chain) ?? []), asset]);
    }
  }
  return byChain;
}

/**
 * A price source that prices each receipt token of `pools` at the coin's price times its pool's
 * coin over its units (decision 0329), one exact ratio the caller rounds; without a usable coin
 * price it answers the coin's failure. Every other asset is priced by `prices`.
 */
export function poolPriced(
  prices: PriceSource,
  pools: ReadonlyMap<AssetRef, HeldPool>,
): PriceSource {
  return {
    async usdPrice(asset, call) {
      call.signal.throwIfAborted();
      const held = pools.get(asset);
      if (held === undefined) {
        return prices.usdPrice(asset, call);
      }
      const { shares, coin } = held.pool;
      const coinPrice = await prices.usdPrice(coin.asset, call);
      if (!coinPrice.ok || !isUsablePrice(coinPrice.value)) {
        return coinPrice.ok ? err("no_price") : coinPrice;
      }
      return ok({
        numerator: coinPrice.value.numerator * coin.base,
        denominator: coinPrice.value.denominator * shares.base,
      });
    },
  };
}

/**
 * Reads the pools of the held tokens the registry does not list from every staking venue on their
 * chain, the first venue that mints one naming it, and answers them with a price source that prices
 * them by their pool (decision 0329). A venue that does not answer names no pool, so its receipt
 * tokens have no price, as any token without one; held tokens of the registry alone ask no venue.
 */
export async function stakePricesOf(
  parts: StakePriceParts,
  held: readonly AssetRef[],
  call: { readonly signal: AbortSignal },
): Promise<StakePrices> {
  const pools = new Map<AssetRef, HeldPool>();
  for (const [chain, receipts] of unlistedByChain(parts.chains, held)) {
    for (const venue of parts.staking.venuesOn(chain)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one venue at a time, the first wins
      const read = await parts.staking.pools(venue, receipts, call);
      const fresh = (read.ok ? read.value : []).filter(({ pool }) => !pools.has(pool.shares.asset));
      fresh.forEach(({ validator, pool }) => {
        pools.set(pool.shares.asset, { venue: venue.id, validator, pool });
      });
    }
  }
  return { pools, prices: poolPriced(parts.prices, pools) };
}
