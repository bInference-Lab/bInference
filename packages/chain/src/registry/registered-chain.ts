import type { ChainRef } from "../caip/chain-ref.js";
import type { ChainFamily, SigningScheme } from "../ports.js";
import type { ChainDefinition } from "./chain-definition.js";

/** A chain the registry holds, with the family and signing scheme that serve it. */
export interface RegisteredChain {
  readonly ref: ChainRef;
  readonly definition: ChainDefinition;
  readonly family: ChainFamily;
  readonly signingScheme: SigningScheme;
}
