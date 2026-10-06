import type { ChainFamily } from "@binference/chain";
import { readEvmDraft } from "./drafts/read-evm-draft.js";
import { parseEvmAddress } from "./evm-address.js";
import { evmFamilyId, evmNamespace } from "./evm-ids.js";

/**
 * Creates the EVM chain family: chains in the `eip155` namespace, addresses in EIP-55 form, and
 * drafts encoded by `encodeEvmDraft`, whose ERC-20 `approve` calls it reads as token approvals.
 */
export function createEvmFamily(): ChainFamily {
  return {
    id: evmFamilyId,
    namespace: evmNamespace,
    parseAddress: parseEvmAddress,
    readDraft: readEvmDraft,
  };
}
