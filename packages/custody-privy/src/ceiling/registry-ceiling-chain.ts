import { type ChainDefinition, declaredContracts, type VenueDeclaration } from "@binference/chain";
import { evmChainOf } from "@binference/chain-evm";
import { ok, type Result } from "@binference/core";
import type { CeilingChain } from "./ceiling.js";

/** What the ceiling takes from the registry for one chain. */
export interface RegistryCeilingRequest {
  /** The chain as the registry defines it; an EVM chain. */
  readonly definition: ChainDefinition;
  /** The declarations of the venues the owner enabled for the agent. */
  readonly venues: readonly VenueDeclaration[];
  /** The most native coin, in base units, one contract call may send. */
  readonly perTxNativeCapBase: bigint;
}

/**
 * The ceiling's view of one chain from the registry: the contracts each enabled venue declares on
 * it, read from the chain definition by name. The spenders are the same contracts, as the venue
 * host accepts an approval only to a contract the venue declared. A name the definition does not
 * hold is an expected failure, so a ceiling never allows less, or more, than the venues use.
 */
export function registryCeilingChain(
  request: RegistryCeilingRequest,
): Result<CeilingChain, "unknown_contract"> {
  const chain = evmChainOf(request.definition);
  const addresses: string[] = [];
  for (const venue of request.venues) {
    const declared = declaredContracts(venue, { ref: chain.ref, definition: request.definition });
    if (!declared.ok) {
      return declared;
    }
    addresses.push(...declared.value);
  }
  const contracts = [...new Set(addresses)];
  return ok({
    chain,
    contracts,
    spenders: contracts,
    perTxNativeCapBase: request.perTxNativeCapBase,
  });
}
