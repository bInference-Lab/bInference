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
import { erc20Namespace } from "../evm-ids.js";
import { encodeEvmDraft } from "./evm-draft.js";

/**
 * Drafts a send from `from`: the chain's coin (the `slip44` namespace) as a plain transfer of its
 * value to the recipient with no calldata, and an ERC-20 token as `transfer(to, amount)` to the
 * token's contract. An asset of another chain than the sender's, of another standard, or a token
 * or recipient whose reference is no address is `unknown_asset`. Accounts outside the EVM family
 * are a `chain.bad_draft` fault, as for any draft.
 */
export function evmTransferDraft(transfer: TokenTransfer): Result<TxDraft, "unknown_asset"> {
  const { from, to, amount } = transfer;
  const asset = assetRefParts(amount.asset);
  const recipient = parseEvmAddress(accountRefParts(to).address);
  const chain = accountRefParts(from).chain;
  if (asset.chain !== chain || !recipient.ok) {
    return err("unknown_asset");
  }
  if (asset.assetNamespace === "slip44") {
    const account = accountRefSchema.parse(`${chain}:${recipient.value}`);
    return ok(encodeEvmDraft({ from, to: account, value: amount.base, data: "0x" }));
  }
  const token = parseEvmAddress(asset.assetReference);
  if (asset.assetNamespace !== erc20Namespace || !token.ok) {
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
