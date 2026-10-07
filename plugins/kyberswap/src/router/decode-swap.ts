import {
  accountRefSchema,
  type ChainRef,
  type DecodedEffect,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import type { ChainSetup } from "../chain-setup.js";
import { readSwapCall } from "./swap-call.js";
import { assetOf } from "./token-address.js";

// A later deadline does not fit a millisecond count that a number holds exactly.
const maxDeadlineSec = BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000));

/**
 * Reads what a KyberSwap trade call does from the draft's bytes alone: the router's recipient, its
 * exact input, its minimum return and the executor's deadline. A draft on a chain the venue does
 * not trade on, a call that is not the router's plain `swap`, or a call aimed at the executor it
 * names is `unknown_call`.
 */
export function decodeSwap(
  draft: TxDraft,
  setups: ReadonlyMap<ChainRef, ChainSetup>,
): Result<DecodedEffect, "unknown_call"> {
  const setup = setups.get(draft.chain);
  const call = decodeEvmDraft(draft);
  const swap = call.ok ? readSwapCall(call.value.data, call.value.value) : undefined;
  const isTrade = swap !== undefined && call.ok && call.value.to !== swap.executor;
  if (setup === undefined || !isTrade || swap.deadlineSec > maxDeadlineSec) {
    return err("unknown_call");
  }
  return ok({
    recipient: accountRefSchema.parse(`${draft.chain}:${swap.recipient}`),
    amountIn: { asset: assetOf(swap.srcToken, setup), base: swap.amount },
    minOut: { asset: assetOf(swap.dstToken, setup), base: swap.minReturn },
    deadlineMs: Number(swap.deadlineSec) * 1000,
  });
}
