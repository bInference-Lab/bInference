import {
  accountRefParts,
  accountRefSchema,
  type TokenApprovalRequest,
  type TxDraft,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { encodeFunctionData, erc20Abi } from "viem";
import { parseEvmAddress } from "../evm-address.js";
import { encodeEvmDraft } from "./evm-draft.js";

/**
 * The EVM family's approval draft: the ERC-20 `approve(spender, amount)` call to the token, from
 * `from`, with no value, which `readEvmDraft` reads back as that approval. A token of another
 * chain, or an address that is no EVM address, is `unknown_asset`.
 */
export function evmApprovalDraft(approval: TokenApprovalRequest): Result<TxDraft, "unknown_asset"> {
  const { from, token, spender, amountBase } = approval;
  const owner = accountRefParts(from);
  const contract = accountRefParts(token);
  const tokenAddress = parseEvmAddress(contract.address);
  const spenderAddress = parseEvmAddress(accountRefParts(spender).address);
  if (contract.chain !== owner.chain || !tokenAddress.ok || !spenderAddress.ok) {
    return err("unknown_asset");
  }
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spenderAddress.value, amountBase],
  });
  const to = accountRefSchema.parse(`${owner.chain}:${tokenAddress.value}`);
  return ok(encodeEvmDraft({ from, to, value: 0n, data }));
}
