import type { ChainDefinition } from "@binference/chain";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { selfHostedDestinations } from "../compose/self-hosted-destinations.js";

/**
 * The chains the address book saves on: those this binference serves, then those a bridge
 * delivers to (decision 0297).
 */
export function addressChains(): readonly ChainDefinition[] {
  return [
    ...selfHostedChains()
      .list()
      .map((chain) => chain.definition),
    ...selfHostedDestinations(),
  ];
}

/**
 * The chain `--chain` names by its registry key, such as `base-mainnet` or `solana`, among
 * {@link addressChains}; the first chain this binference serves when it names none, and
 * `undefined` for a key none of them has.
 */
export function addressChainOf(key: string | undefined): ChainDefinition | undefined {
  const chains = addressChains();
  return key === undefined ? chains[0] : chains.find((chain) => chain.key === key);
}
