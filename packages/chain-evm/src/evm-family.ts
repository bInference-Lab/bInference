import type { ChainFamily } from "@binference/chain";
import { readEvmDraft } from "./drafts/read-evm-draft.js";
import { evmApprovalDraft } from "./drafts/token-approval-draft.js";
import { evmTransferDraft } from "./drafts/token-transfer-draft.js";
import { parseEvmAddress } from "./evm-address.js";
import { erc20Namespace, evmFamilyId, evmNamespace } from "./evm-ids.js";
import { freshEvmAccount } from "./fresh-evm-account.js";

/**
 * Creates the EVM chain family: chains in the `eip155` namespace, addresses in EIP-55 form, and
 * drafts encoded by `encodeEvmDraft`, whose ERC-20 `approve` calls it reads as token approvals.
 * Its tokens are ERC-20 tokens and its token transfers their `transfer` calls; a send of the coin is
 * a plain transfer; a fresh account takes its address from the seed's first 20 bytes.
 */
export function createEvmFamily(): ChainFamily {
  return {
    id: evmFamilyId,
    namespace: evmNamespace,
    tokenNamespace: erc20Namespace,
    parseAddress: parseEvmAddress,
    readDraft: readEvmDraft,
    freshAccount: freshEvmAccount,
    transferDraft: evmTransferDraft,
    approvalDraft: evmApprovalDraft,
  };
}
