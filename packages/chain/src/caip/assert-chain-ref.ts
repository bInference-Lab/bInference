import { BinferenceError } from "@binference/core";
import { type ChainRef, isChainRef } from "./chain-ref.js";

/**
 * Brands the chain part of an account or asset id that already passed its grammar. A text that
 * fails is a bug in the caller, so it throws.
 */
export function assertChainRef(text: string): ChainRef {
  if (!isChainRef(text)) {
    throw new BinferenceError({
      code: "chain.bad_chain_part",
      message: "The chain part of a parsed id is not a CAIP-2 chain id.",
    });
  }
  return text;
}
