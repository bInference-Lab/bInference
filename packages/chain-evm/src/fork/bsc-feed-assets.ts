import { bsc, bscPriceFeeds, type PriceFeedDefinition } from "@binference/chains";
import { BinferenceError } from "@binference/core";
import { type EvmChain, erc20AssetRef } from "../evm-chain.js";
import type { FeedAsset, UsdFeed } from "../prices/price-from-round.js";
import { bscContract, bscToken } from "./bsc-addresses.js";

function tokenDecimals(symbol: string): number {
  const token = bsc.tokens.find((item) => item.symbol === symbol);
  if (token === undefined) {
    throw new BinferenceError({
      code: "fork.unknown_address",
      message: `The BSC registry has no ${symbol}.`,
      details: { symbol },
    });
  }
  return token.decimals;
}

// The native coin from its feed, and each token that wraps it one for one at the same price.
function nativeFeedAssets(
  chain: EvmChain,
  definition: PriceFeedDefinition,
  feed: UsdFeed,
): FeedAsset[] {
  const wrappers = (definition.wrappers ?? []).map((symbol) => ({
    asset: erc20AssetRef(chain, bscToken(symbol)),
    decimals: tokenDecimals(symbol),
    isStablecoin: false,
    feed,
  }));
  const { nativeAsset: asset, nativeDecimals: decimals } = chain;
  return [{ asset, decimals, isStablecoin: false, feed }, ...wrappers];
}

/**
 * BSC's feed assets from the registry in `@binference/chains`: BNB from its feed, WBNB (its one
 * for one wrapper) from the same feed, and each stablecoin feed's token at $1 while the feed holds
 * its peg. The BTC and ETH feeds stay unused: decision 0059 prices every other token from the
 * trade's own quote.
 */
export function bscFeedAssets(chain: EvmChain): readonly FeedAsset[] {
  return bscPriceFeeds.flatMap((definition): FeedAsset[] => {
    const feed = {
      address: bscContract("chainlink", definition.contract),
      decimals: definition.decimals,
      heartbeatSeconds: definition.heartbeatSeconds,
    };
    if (definition.symbol === chain.nativeSymbol) {
      return nativeFeedAssets(chain, definition, feed);
    }
    if (!definition.isStablecoin) {
      return [];
    }
    const asset = erc20AssetRef(chain, bscToken(definition.symbol));
    return [{ asset, decimals: tokenDecimals(definition.symbol), isStablecoin: true, feed }];
  });
}
