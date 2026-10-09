import {
  accountRefParts,
  accountRefSchema,
  assetRefParts,
  type TokenTransfer,
  type TxDraft,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { encodeFunctionData, erc20Abi } from "viem";
import { parseEvmAddress } from "../evm-address.js";
import { encodeEvmDraft } from "./evm-draft.js";

/**
 * Drafts an ERC-20 `transfer(to, amount)` from `from` to the token's contract. A token of another
 * chain than the sender's, an asset that is not an ERC-20 token (the native coin among them) or a
 * token whose reference is no address is `unknown_asset`. Accounts outside the EVM family are a
 * `chain.bad_draft` fault, as for any draft.
 */
export function evmTransferDraft(transfer: TokenTransfer): Result<TxDraft, "unknown_asset"> {
  const { from, to, amount } = transfer;
  const asset = assetRefParts(amount.asset);
  const token = parseEvmAddress(asset.assetReference);
  const recipient = parseEvmAddress(accountRefParts(to).address);
  const chain = accountRefParts(from).chain;
  if (asset.chain !== chain || asset.assetNamespace !== "erc20" || !token.ok || !recipient.ok) {
    return err("unknown_asset");
  }
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient.value, amount.base],
  });
  const contract = accountRefSchema.parse(`${chain}:${token.value}`);
  return ok(encodeEvmDraft({ from, to: contract, value: 0n, data }));
}
