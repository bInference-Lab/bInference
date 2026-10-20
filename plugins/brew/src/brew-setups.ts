import {
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  BinferenceError,
  type ChainRef,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { BrewChain } from "./brew-options.js";

/** What the venue knows about one chain it serves: its coin and its wrapped coin's address. */
export interface BrewSetup {
  readonly chain: ChainRef;
  readonly nativeAsset: AssetRef;
  /** The wrapped coin's address, in checksum form. */
  readonly wrappedNative: Address;
}

function refuse(chain: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: "brew.bad_options",
    message: `Brew cannot serve ${chain}: ${problem}`,
    details: { chain },
  });
}

function setupOf(item: BrewChain): BrewSetup {
  const { chain, assetNamespace, assetReference } = assetRefParts(item.wrappedNative);
  const address = parseEvmAddress(assetReference);
  if (chain !== item.chain || assetNamespace !== "erc20" || !address.ok) {
    throw refuse(item.chain, "its wrapped coin is no ERC-20 token of the chain.");
  }
  if (assetRefParts(item.nativeAsset).chain !== item.chain) {
    throw refuse(item.chain, "its coin is of another chain.");
  }
  return { chain: item.chain, nativeAsset: item.nativeAsset, wrappedNative: address.value };
}

/**
 * Each chain's setup, by its reference. A chain given twice, or a coin or wrapped coin that is
 * not of its chain, is a fault (`brew.bad_options`).
 */
export function brewSetupsOf(chains: readonly BrewChain[]): ReadonlyMap<ChainRef, BrewSetup> {
  const setups = new Map<ChainRef, BrewSetup>();
  for (const item of chains) {
    if (setups.has(item.chain)) {
      throw refuse(item.chain, "the chain is given twice.");
    }
    setups.set(item.chain, setupOf(item));
  }
  return setups;
}

/** The asset an address names on a chain: the coin for its wrapped coin, else that ERC-20 token. */
export function brewAssetOf(address: Address, setup: BrewSetup): AssetRef {
  if (address.toLowerCase() === setup.wrappedNative.toLowerCase()) {
    return setup.nativeAsset;
  }
  return assetRefSchema.parse(`${setup.chain}/erc20:${address}`);
}
