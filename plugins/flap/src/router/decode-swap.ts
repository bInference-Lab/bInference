import {
  accountRefSchema,
  type DecodedEffect,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { curveAssetOf, decodeEvmDraft } from "@binference/plugin-sdk/evm";
import type { VenueParts } from "../venue-parts.js";
import { readSwapCall } from "./swap-call.js";

/**
 * Reads what a Flap trade call does from the draft's bytes alone. The Portal pays the account that
 * calls it, so the recipient is the draft's sender; the input and the minimum out are the call's
 * own; and the call carries no deadline. A draft on a chain the venue does not trade on, or a call
 * that is not a plain `swapExactInput`, is `unknown_call`.
 */
export function decodeSwap(
  draft: TxDraft,
  parts: VenueParts,
): Result<DecodedEffect, "unknown_call"> {
  const setup = parts.setups.get(draft.chain);
  const call = decodeEvmDraft(draft);
  const swap = call.ok ? readSwapCall(call.value.data, call.value.value) : undefined;
  if (setup === undefined || !call.ok || swap === undefined) {
    return err("unknown_call");
  }
  return ok({
    recipient: accountRefSchema.parse(`${setup.chain}:${call.value.from}`),
    amountIn: { asset: curveAssetOf(swap.inputToken, setup), base: swap.inputAmount },
    minOut: { asset: curveAssetOf(swap.outputToken, setup), base: swap.minOutputAmount },
  });
}
