import {
  type AccountRef,
  accountRefParts,
  BinferenceError,
  type ChainRef,
  type Http,
  type Random,
  type TxSimulator,
} from "@binference/plugin-sdk";
import { type CurveChainSetup, parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { FlapLaunchOptions } from "../flap-options.js";

/** One chain Flap launches on: its curves' setup, its simulator and its tax token implementation. */
export interface LaunchChain {
  readonly setup: CurveChainSetup;
  readonly simulator: Pick<TxSimulator, "simulate">;
  readonly implementation: Address;
}

/** What the launcher's parts share: Flap's API, the salts' randomness and each launch chain. */
export interface LaunchParts {
  readonly http: Http;
  readonly random: Random;
  readonly chains: ReadonlyMap<ChainRef, LaunchChain>;
}

function refuse(chain: ChainRef, problem: string): BinferenceError {
  return new BinferenceError({
    code: "flap.bad_options",
    message: `Flap cannot launch on ${chain}: ${problem}`,
    details: { chain },
  });
}

function implementationOf(chain: ChainRef, account: AccountRef): Address {
  const parts = accountRefParts(account);
  const address = parseEvmAddress(parts.address);
  if (parts.chain !== chain || !address.ok) {
    throw refuse(chain, "its tax token implementation is no EVM account of the chain.");
  }
  return address.value;
}

/**
 * The launcher's parts from the venue's options: each launch chain with the setup of the same chain
 * the venue trades on. A launch chain the venue does not trade on, one given twice, or an
 * implementation on another chain is a fault (`flap.bad_options`).
 */
export function launchPartsOf(
  options: FlapLaunchOptions,
  setups: ReadonlyMap<ChainRef, CurveChainSetup>,
): LaunchParts {
  const chains = new Map<ChainRef, LaunchChain>();
  for (const item of options.chains) {
    const setup = setups.get(item.chain);
    if (setup === undefined || chains.has(item.chain)) {
      throw refuse(item.chain, "the venue does not trade there, or the chain is given twice.");
    }
    const implementation = implementationOf(item.chain, item.taxTokenImplementation);
    chains.set(item.chain, { setup, simulator: item.simulator, implementation });
  }
  return { http: options.http, random: options.random, chains };
}
