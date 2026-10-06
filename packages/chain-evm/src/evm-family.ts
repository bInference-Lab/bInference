import type { ChainFamily } from "@binference/chain";
import { parseEvmAddress } from "./evm-address.js";

/** The EVM family's registry id, which chain definitions name in `family`. */
export const evmFamilyId = "evm";

/** The CAIP-2 namespace of EVM chains. */
export const evmNamespace = "eip155";

/** Creates the EVM chain family: chains in the `eip155` namespace, addresses in EIP-55 form. */
export function createEvmFamily(): ChainFamily {
  return { id: evmFamilyId, namespace: evmNamespace, parseAddress: parseEvmAddress };
}
