import {
  type AssetRef,
  assetRefParts,
  BinferenceError,
  type ChainRef,
} from "@binference/plugin-sdk";
import type { OkxChain } from "./okx-options.js";

/** What the venue knows about one chain it trades on. */
export interface ChainSetup {
  readonly chain: ChainRef;
  /** The chain's `chainIndex` in OKX's API, such as `56`. */
  readonly chainIndex: string;
  readonly nativeAsset: AssetRef;
}

// OKX's API names each chain by its index; its list of supported networks gives the index of BNB
// Chain as 56. A chain gets its index here when binference enables it.
const chainIndexes: Readonly<Record<string, string>> = { "eip155:56": "56" };

function refuse(chain: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: "okx.bad_options",
    message: `OKX cannot trade on ${chain}: ${problem}`,
    details: { chain },
  });
}

function setupOf(item: OkxChain): ChainSetup {
  const chainIndex = chainIndexes[item.chain];
  if (chainIndex === undefined) {
    throw refuse(item.chain, "OKX's API has no index for this chain here.");
  }
  const native = assetRefParts(item.nativeAsset);
  if (native.chain !== item.chain || native.assetNamespace !== "slip44") {
    throw refuse(item.chain, "its native asset is not the chain's own coin.");
  }
  return { chain: item.chain, chainIndex, nativeAsset: item.nativeAsset };
}

/**
 * Reads the chains the venue trades on, keyed by chain. No chain, a chain OKX's API has no index
 * for here, a native asset that is not the chain's coin, or a chain named twice is a fault, so the
 * venue fails when it is made, never when it trades.
 */
export function chainSetupsOf(chains: readonly OkxChain[]): ReadonlyMap<ChainRef, ChainSetup> {
  const setups = new Map(chains.map((item) => [item.chain, setupOf(item)]));
  if (setups.size === 0 || setups.size !== chains.length) {
    throw refuse("its chains", "name at least one chain, and each chain once.");
  }
  return setups;
}
