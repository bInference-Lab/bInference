import {
  BinferenceError,
  type ChainRef,
  type Random,
  type TxSimulator,
} from "@binference/plugin-sdk";
import type { CurveChainSetup } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { GeniusfunLaunchOptions } from "../geniusfun-options.js";
import { type BoundedMemo, createBoundedMemo } from "../launch/bounded-memo.js";

/** One chain Genius.fun launches on: its curves' setup and its simulator. */
export interface LaunchChain {
  readonly setup: CurveChainSetup;
  readonly simulator: Pick<TxSimulator, "simulate">;
}

/**
 * What the launcher's parts share: the salts' randomness, each launch chain, and the token each
 * create call it built makes, by the call's chain, sender, contract and calldata, which the
 * decoder reads a call's token from.
 */
export interface LaunchParts {
  readonly random: Random;
  readonly chains: ReadonlyMap<ChainRef, LaunchChain>;
  readonly built: BoundedMemo<string, Address>;
}

// Create calls a running engine keeps the token of; the oldest goes first past it.
const keptBuilds = 64;

/**
 * The launcher's parts from the venue's options: each launch chain with the setup of the same chain
 * the venue trades on. A launch chain the venue does not trade on, or one given twice, is a fault
 * (`geniusfun.bad_options`).
 */
export function launchPartsOf(
  options: GeniusfunLaunchOptions,
  setups: ReadonlyMap<ChainRef, CurveChainSetup>,
): LaunchParts {
  const chains = new Map<ChainRef, LaunchChain>();
  for (const item of options.chains) {
    const setup = setups.get(item.chain);
    if (setup === undefined || chains.has(item.chain)) {
      throw new BinferenceError({
        code: "geniusfun.bad_options",
        message: `Genius.fun cannot launch on ${item.chain}: the venue does not trade there, or the chain is given twice.`,
        details: { chain: item.chain },
      });
    }
    chains.set(item.chain, { setup, simulator: item.simulator });
  }
  return { random: options.random, chains, built: createBoundedMemo(keptBuilds) };
}
