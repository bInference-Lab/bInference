import {
  type AssetRef,
  assetRefParts,
  BinferenceError,
  type Bps,
  type ChainRef,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { KyberswapChain } from "./kyberswap-options.js";

/** What the venue knows about one chain it trades on. */
export interface ChainSetup {
  readonly chain: ChainRef;
  /** The chain's name in the path of KyberSwap's API, such as `bsc`. */
  readonly slug: string;
  readonly nativeAsset: AssetRef;
  /** The allowed hooks, in checksum form. */
  readonly allowedHooks: ReadonlySet<Address>;
  /** The fee each allowed hook keeps, by its address in checksum form. */
  readonly hookFees: ReadonlyMap<Address, Bps>;
}

// KyberSwap's API names each chain in its path; its API reference lists the names by chain id.
// A chain gets its name here when binference enables it.
const slugs: Readonly<Record<string, string>> = { "eip155:56": "bsc" };

function refuse(chain: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: "kyberswap.bad_options",
    message: `KyberSwap cannot trade on ${chain}: ${problem}`,
    details: { chain },
  });
}

function hookFeesOf(item: KyberswapChain): ReadonlyMap<Address, Bps> {
  const fees = new Map(
    item.allowedHooks.map((hook): [Address, Bps] => {
      const parsed = parseEvmAddress(hook.address);
      if (!parsed.ok) {
        throw refuse(item.chain, "an allowed hook is no EVM address.");
      }
      return [parsed.value, hook.feeBps];
    }),
  );
  if (fees.size !== item.allowedHooks.length) {
    throw refuse(item.chain, "an allowed hook is named twice.");
  }
  return fees;
}

function setupOf(item: KyberswapChain): ChainSetup {
  const slug = slugs[item.chain];
  if (slug === undefined) {
    throw refuse(item.chain, "KyberSwap's API has no name for this chain here.");
  }
  const native = assetRefParts(item.nativeAsset);
  if (native.chain !== item.chain || native.assetNamespace !== "slip44") {
    throw refuse(item.chain, "its native asset is not the chain's own coin.");
  }
  const hookFees = hookFeesOf(item);
  const allowedHooks = new Set(hookFees.keys());
  return { chain: item.chain, slug, nativeAsset: item.nativeAsset, allowedHooks, hookFees };
}

/**
 * Reads the chains the venue trades on, keyed by chain. No chain, a chain KyberSwap's API has no
 * name for, a native asset that is not the chain's coin, a hook that is no EVM address, a hook or
 * a chain named twice is a fault, so the venue fails when it is made, never when it trades.
 */
export function chainSetupsOf(
  chains: readonly KyberswapChain[],
): ReadonlyMap<ChainRef, ChainSetup> {
  const setups = new Map(chains.map((item) => [item.chain, setupOf(item)]));
  if (setups.size === 0 || setups.size !== chains.length) {
    throw refuse("its chains", "name at least one chain, and each chain once.");
  }
  return setups;
}
