import type { ChainDefinition, PriceFeedDefinition } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { Address } from "viem";
import { parseEvmAddress } from "../evm-address.js";
import { erc20AssetRef, type EvmChain, evmChainOf } from "../evm-chain.js";
import type { FeedAsset, UsdFeed } from "./price-from-round.js";

// A chain's feed proxies are its contracts under this group.
const feedGroup = "chainlink";

function refuse(definition: ChainDefinition, name: string): BinferenceError {
  return new BinferenceError({
    code: "chain.bad_price_feeds",
    message: `The ${definition.key} registry has no ${name} for its price feeds.`,
    details: { chain: definition.key, name },
  });
}

// The address the registry gives `name`; one it does not hold, or holds malformed, is a fault.
function addressOf(
  definition: ChainDefinition,
  entry: { readonly address: string } | undefined,
  name: string,
): Address {
  const address = entry === undefined ? undefined : parseEvmAddress(entry.address);
  if (address?.ok !== true) {
    throw refuse(definition, name);
  }
  return address.value;
}

function tokenOf(
  definition: ChainDefinition,
  symbol: string,
): { readonly address: Address; readonly decimals: number } {
  const token = definition.tokens.find((item) => item.symbol === symbol);
  if (token === undefined) {
    throw refuse(definition, symbol);
  }
  return { address: addressOf(definition, token, symbol), decimals: token.decimals };
}

// The coin from its feed, and each token that wraps it one for one at the same price.
function coinAssets(
  definition: ChainDefinition,
  chain: EvmChain,
  item: { readonly feed: UsdFeed; readonly wrappers: readonly string[] },
): FeedAsset[] {
  const { feed } = item;
  const wrappers = item.wrappers.map((symbol): FeedAsset => {
    const token = tokenOf(definition, symbol);
    const asset = erc20AssetRef(chain, token.address);
    return { asset, decimals: token.decimals, isStablecoin: false, feed };
  });
  const { nativeAsset: asset, nativeDecimals: decimals } = chain;
  return [{ asset, decimals, isStablecoin: false, feed }, ...wrappers];
}

/**
 * The assets a chain's Chainlink USD feeds price (decision 0059), read from its registry
 * definition: the coin from the feed of its symbol, and each token that wraps it one for one from
 * the same feed; each stablecoin feed's token at $1 while the feed holds its peg. Every other feed
 * stays unused: other tokens take the trade's own quote. A feed whose proxy or token the definition
 * does not name is a `chain.bad_price_feeds` fault, so a start never runs on a feed it cannot read.
 */
export function feedAssetsOf(
  definition: ChainDefinition,
  feeds: readonly PriceFeedDefinition[],
): readonly FeedAsset[] {
  const chain = evmChainOf(definition);
  return feeds.flatMap((item): FeedAsset[] => {
    const contract = definition.contracts.find(
      (entry) => entry.venue === feedGroup && entry.name === item.contract,
    );
    const feed = {
      address: addressOf(definition, contract, item.contract),
      decimals: item.decimals,
      heartbeatSeconds: item.heartbeatSeconds,
    };
    if (item.symbol === chain.nativeSymbol) {
      return coinAssets(definition, chain, { feed, wrappers: item.wrappers ?? [] });
    }
    if (!item.isStablecoin) {
      return [];
    }
    const token = tokenOf(definition, item.symbol);
    const asset = erc20AssetRef(chain, token.address);
    return [{ asset, decimals: token.decimals, isStablecoin: true, feed }];
  });
}
