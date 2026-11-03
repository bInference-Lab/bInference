import type { ChainRef, VenueContracts } from "@binference/plugin-sdk";
import { registerCallJson } from "./calls/register-call.js";

/** The registry's name in the chain registry: every registration goes to it. */
export const identityRegistryName = "identity-registry";

/**
 * The name under which the chain registry pins the contract the registry's proxy ran when the
 * plugin was tested; no call goes to it.
 */
export const identityImplementationName = "identity-registry-implementation";

/**
 * What the plugin declares on a chain: the identity registry and its one call, `register(string)`,
 * whose identity the registry mints to the caller, so no input names who is credited. The
 * registry's ERC-721 `approve` shares an ERC-20 approval's selector, so the registry is declared
 * as a contract no approval is ever sent to (decision 0304). No spender.
 */
export function erc8004ContractsOn(chain: ChainRef): VenueContracts {
  return {
    chain,
    names: [identityRegistryName],
    calls: [{ contract: identityRegistryName, abi: registerCallJson, walletInputs: [] }],
    unapproved: [identityRegistryName],
  };
}
