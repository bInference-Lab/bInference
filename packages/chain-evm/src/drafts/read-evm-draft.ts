import { accountRefSchema, assetRefSchema, type DraftCall, type TxDraft } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { parseAbi, toFunctionSelector } from "viem";
import { decodeCall } from "../decoding/decode-call.js";
import { decodeEvmDraft } from "./evm-draft.js";

const approveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const approveSelector = toFunctionSelector("approve(address,uint256)");

/**
 * Reads an EVM draft for the chain-neutral core: the contract it calls, the wei it sends and, for
 * an ERC-20 `approve`, the token, the spender and the allowance. A call with the `approve` selector
 * whose arguments do not decode is an expected failure, never a plain call.
 */
export function readEvmDraft(draft: TxDraft): Result<DraftCall, "malformed_draft"> {
  const call = decodeEvmDraft(draft);
  if (!call.ok) {
    return call;
  }
  const { to, value, data } = call.value;
  const target = accountRefSchema.parse(`${draft.chain}:${to}`);
  if (!data.startsWith(approveSelector)) {
    return ok({ target, nativeValue: value });
  }
  const approve = decodeCall(approveAbi, data);
  if (!approve.ok) {
    return err("malformed_draft");
  }
  const [spender, amountBase] = approve.value.args;
  const approval = {
    asset: assetRefSchema.parse(`${draft.chain}/erc20:${to}`),
    spender: accountRefSchema.parse(`${draft.chain}:${spender}`),
    amountBase,
  };
  return ok({ target, nativeValue: value, approval });
}
