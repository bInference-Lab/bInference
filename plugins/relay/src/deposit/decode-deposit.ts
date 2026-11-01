import {
  accountRefSchema,
  assetRefSchema,
  type DecodedDeposit,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import { readDepositErc20 } from "./deposit-call.js";

/**
 * Reads what a Relay deposit does from the draft's bytes alone, as an order deposit (decision
 * 0317): the contract it calls, its depositor, the exact token and amount that leave, and the id
 * of the order it pays. Only `depositErc20` in the exact form the bridge builds, from the
 * depositor itself and with no native value, decodes; any other call, `depositNative` among them,
 * which no listed route builds, is `unknown_call`.
 */
export function decodeDeposit(draft: TxDraft): Result<DecodedDeposit, "unknown_call"> {
  const call = decodeEvmDraft(draft);
  const terms = call.ok && call.value.value === 0n ? readDepositErc20(call.value.data) : undefined;
  if (!call.ok || terms === undefined || terms.depositor !== call.value.from) {
    return err("unknown_call");
  }
  return ok({
    kind: "order",
    contract: accountRefSchema.parse(`${draft.chain}:${call.value.to}`),
    depositor: draft.from,
    amountIn: {
      asset: assetRefSchema.parse(`${draft.chain}/erc20:${terms.token}`),
      base: terms.amount,
    },
    orderId: terms.orderId,
  });
}
