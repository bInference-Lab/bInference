import { type AssetRef, assetRefParts, assetRefSchema } from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { ChainSetup } from "../chain-setup.js";

/** How KyberSwap's API and router write the chain's own coin. */
export const nativeToken: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/**
 * The address KyberSwap writes for an asset on the chain: the chain's coin or an ERC-20 token.
 * Undefined for any other asset, which KyberSwap does not trade here.
 */
export function tokenOf(asset: AssetRef, setup: ChainSetup): Address | undefined {
  if (asset === setup.nativeAsset) {
    return nativeToken;
  }
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const token = parseEvmAddress(assetReference);
  const isToken = chain === setup.chain && assetNamespace === "erc20" && token.ok;
  return isToken && token.value !== nativeToken ? token.value : undefined;
}

/** The asset an address of KyberSwap's names on the chain, in checksum form. */
export function assetOf(token: Address, setup: ChainSetup): AssetRef {
  return token === nativeToken
    ? setup.nativeAsset
    : assetRefSchema.parse(`${setup.chain}/erc20:${token}`);
}
