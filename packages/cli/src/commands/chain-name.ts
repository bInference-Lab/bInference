import type { ChainRef } from "@binference/chain";
import { addressChains } from "./address-chain.js";

/**
 * The chain's name when this binference serves it or a bridge delivers to it, such as BNB Smart
 * Chain or Base; else its id.
 */
export function chainName(chain: ChainRef): string {
  return addressChains().find((item) => item.id === chain)?.name ?? chain;
}
