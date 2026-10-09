import type { ChainFamily } from "@binference/chain";
import { readEvmDraft } from "./drafts/read-evm-draft.js";
import { evmTransferDraft } from "./drafts/token-transfer-draft.js";
import { parseEvmAddress } from "./evm-address.js";
import { evmFamilyId, evmNamespace } from "./evm-ids.js";
import { freshEvmAccount } from "./fresh-evm-account.js";

/**
 * Creates the EVM chain family: chains in the `eip155` namespace, addresses in EIP-55 form, and
 * drafts encoded by `encodeEvmDraft`, whose ERC-20 `approve` calls it reads as token approvals.
 * Its token transfers are ERC-20 `transfer` calls; a fresh account takes its address from the
 * seed's first 20 bytes.
 */
export function createEvmFamily(): ChainFamily {
  return {
    id: evmFamilyId,
    namespace: evmNamespace,
    parseAddress: parseEvmAddress,
    readDraft: readEvmDraft,
    freshAccount: freshEvmAccount,
    transferDraft: evmTransferDraft,
  };
}
