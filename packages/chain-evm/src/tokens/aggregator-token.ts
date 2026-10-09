import { type AssetRef, assetRefParts, assetRefSchema, type ChainRef } from "@binference/chain";
import type { Address } from "viem";
import { parseEvmAddress } from "../evm-address.js";

/**
 * How DEX aggregators write a chain's own coin in their APIs and router calls, where an ERC-20
 * token address would stand: `0xEeee…EEeE`, in checksum form.
 */
export const aggregatorNativeToken: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** The chain an aggregator trades on, and its own coin. */
export interface AggregatorChain {
  readonly chain: ChainRef;
  readonly nativeAsset: AssetRef;
}

/**
 * The address an aggregator writes for an asset on the chain: {@link aggregatorNativeToken} for
 * the chain's coin, or the ERC-20 token's address in checksum form. Undefined for an asset of
 * another chain or another kind, which the aggregator does not trade there.
 */
export function aggregatorTokenOf(asset: AssetRef, on: AggregatorChain): Address | undefined {
  if (asset === on.nativeAsset) {
    return aggregatorNativeToken;
  }
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const token = parseEvmAddress(assetReference);
  const isToken = chain === on.chain && assetNamespace === "erc20" && token.ok;
  return isToken && token.value !== aggregatorNativeToken ? token.value : undefined;
}

/** The asset an aggregator's token address names on the chain. */
export function aggregatorAssetOf(token: Address, on: AggregatorChain): AssetRef {
  return token === aggregatorNativeToken
    ? on.nativeAsset
    : assetRefSchema.parse(`${on.chain}/erc20:${token}`);
}
