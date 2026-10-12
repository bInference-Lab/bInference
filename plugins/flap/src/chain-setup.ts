import {
  type AssetRef,
  assetRefParts,
  BinferenceError,
  type ChainRef,
} from "@binference/plugin-sdk";
import { parseEvmAddress, type RpcFailover } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { FlapChain } from "./flap-options.js";

/** What the venue knows about one chain it trades on. */
export interface ChainSetup {
  readonly chain: ChainRef;
  readonly nativeAsset: AssetRef;
  /** The tokens a curve it quotes may trade against, besides the coin, by their address. */
  readonly quoteTokens: ReadonlyMap<Address, AssetRef>;
  readonly rpc: RpcFailover;
}

function refuse(chain: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: "flap.bad_options",
    message: `Flap cannot trade on ${chain}: ${problem}`,
    details: { chain },
  });
}

// An ERC-20 token of the chain, by its address in checksum form.
function tokenEntry(item: FlapChain, asset: AssetRef): [Address, AssetRef] {
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const address = parseEvmAddress(assetReference);
  if (chain !== item.chain || assetNamespace !== "erc20" || !address.ok) {
    throw refuse(item.chain, "a quote token is no ERC-20 token of the chain.");
  }
  return [address.value, asset];
}

function setupOf(item: FlapChain): ChainSetup {
  const native = assetRefParts(item.nativeAsset);
  if (native.chain !== item.chain || native.assetNamespace !== "slip44") {
    throw refuse(item.chain, "its native asset is not the chain's own coin.");
  }
  const quoteTokens = new Map(item.quoteTokens.map((asset) => tokenEntry(item, asset)));
  if (quoteTokens.size !== item.quoteTokens.length) {
    throw refuse(item.chain, "a quote token is named twice.");
  }
  return { chain: item.chain, nativeAsset: item.nativeAsset, quoteTokens, rpc: item.rpc };
}

/**
 * Reads the chains the venue trades on, keyed by chain. No chain, a chain named twice, a native
 * asset that is not the chain's coin, or a quote token that is no ERC-20 token of the chain is a
 * fault, so the venue fails when it is made, never when it trades.
 */
export function chainSetupsOf(chains: readonly FlapChain[]): ReadonlyMap<ChainRef, ChainSetup> {
  const setups = new Map(chains.map((item) => [item.chain, setupOf(item)]));
  if (setups.size === 0 || setups.size !== chains.length) {
    throw refuse("its chains", "name at least one chain, and each chain once.");
  }
  return setups;
}
