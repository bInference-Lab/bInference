import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type TxDraft,
} from "@binference/chain";
import { type Address, encodeFunctionData, erc20Abi } from "viem";
import { encodeEvmDraft } from "./evm-draft.js";

/** An exact ERC-20 approval: the wallet lets the spender take this much of the token, no more. */
export interface EvmApproval {
  readonly wallet: AccountRef;
  readonly token: Address;
  readonly spender: Address;
  readonly amountBase: bigint;
}

/**
 * Encodes an exact ERC-20 approval as a draft from the wallet to the token, on the wallet's chain,
 * with no native value: the step a venue builds before a trade that spends a token.
 */
export function encodeEvmApproval(approval: EvmApproval): TxDraft {
  const chain = accountRefParts(approval.wallet).chain;
  return encodeEvmDraft({
    from: approval.wallet,
    to: accountRefSchema.parse(`${chain}:${approval.token}`),
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [approval.spender, approval.amountBase],
    }),
  });
}
