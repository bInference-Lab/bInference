import type { ChainRef } from "@binference/chain";
import { selfHostedChains } from "../compose/open-engine-parts.js";

/** The chain's name when this binference serves it, such as BNB Smart Chain; else its id. */
export function chainName(chain: ChainRef): string {
  const registered = selfHostedChains().get(chain);
  return registered.ok ? registered.value.definition.name : chain;
}
