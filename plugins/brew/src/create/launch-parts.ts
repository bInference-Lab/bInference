import {
  type AssetRef,
  BinferenceError,
  type ChainRef,
  type Random,
  type TxDraft,
  type TxSimulator,
} from "@binference/plugin-sdk";
import type { RpcFailover } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { BrewLaunchOptions, BrewPair } from "../brew-options.js";
import { type BrewSetup, quoteTokenOf } from "../brew-setups.js";

/** One chain Brew launches on: its setup, its reads, its simulator and its pairs by asset. */
export interface LaunchChain {
  readonly setup: BrewSetup;
  readonly rpc: RpcFailover;
  readonly simulator: Pick<TxSimulator, "simulate">;
  readonly pairs: ReadonlyMap<AssetRef, BrewPair>;
}

/** What a create call the launcher built writes that its bytes alone do not tell. */
export interface BuiltLaunch {
  /** The starting market cap the call's tick comes from, in base units of the pair. */
  readonly startMarketCap: bigint;
  /** The quote worked that start out from binference's USD price of the pair. */
  readonly isStartPriced: boolean;
  /** BrewFactory, which the call must be sent to. */
  readonly factory: Address;
  /** The distributor factory a token's holder distributor's address follows from. */
  readonly distributorFactory: Address;
}

/**
 * What the launcher's parts share: the salts' randomness, each launch chain, and what each create
 * call it built writes beyond its bytes, by the call's chain, sender, value and calldata, which
 * the decoder reads it from.
 */
export interface LaunchParts {
  readonly random: Random;
  readonly chains: ReadonlyMap<ChainRef, LaunchChain>;
  readonly built: Map<string, BuiltLaunch>;
}

// Create calls a running engine keeps; the oldest goes first past it.
const keptBuilds = 64;

/** The key a built create call is kept by: its chain, its sender and its whole payload. */
export function builtKeyOf(draft: TxDraft): string {
  return `${draft.chain}|${draft.from}|${draft.payload}`.toLowerCase();
}

/** Keeps what a built create call writes beyond its bytes, the oldest dropped past 64. */
export function keepBuilt(parts: LaunchParts, key: string, built: BuiltLaunch): void {
  parts.built.delete(key);
  parts.built.set(key, built);
  for (const oldest of parts.built.keys()) {
    if (parts.built.size <= keptBuilds) {
      return;
    }
    parts.built.delete(oldest);
  }
}

function refuse(chain: string, problem: string): BinferenceError {
  return new BinferenceError({
    code: "brew.bad_options",
    message: `Brew cannot launch on ${chain}: ${problem}`,
    details: { chain },
  });
}

// A pair is the coin or a token of the chain, never its wrapped coin, each once.
function pairsOf(item: BrewLaunchOptions["chains"][number], setup: BrewSetup) {
  const pairs = new Map<AssetRef, BrewPair>();
  for (const pair of item.pairs) {
    if (quoteTokenOf(pair.asset, setup) === undefined || pairs.has(pair.asset)) {
      throw refuse(item.chain, "a pair is not of the chain, is its wrapped coin, or repeats.");
    }
    pairs.set(pair.asset, pair);
  }
  return pairs;
}

/**
 * The launcher's parts from the venue's options: each launch chain with the setup of the same
 * chain the venue serves. A launch chain the venue does not serve, one given twice, or a pair
 * that is not of its chain, is its wrapped coin or repeats, is a fault (`brew.bad_options`).
 */
export function launchPartsOf(
  options: BrewLaunchOptions,
  setups: ReadonlyMap<ChainRef, BrewSetup>,
): LaunchParts {
  const chains = new Map<ChainRef, LaunchChain>();
  for (const item of options.chains) {
    const setup = setups.get(item.chain);
    if (setup === undefined || chains.has(item.chain)) {
      throw refuse(item.chain, "the venue does not serve it, or it is given twice.");
    }
    const { rpc, simulator } = item;
    chains.set(item.chain, { setup, rpc, simulator, pairs: pairsOf(item, setup) });
  }
  return { random: options.random, chains, built: new Map() };
}
