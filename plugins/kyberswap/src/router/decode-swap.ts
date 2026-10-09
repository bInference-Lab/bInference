import {
  type ChainRef,
  type DecodedEffect,
  err,
  ok,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import { aggregatorEffectOf, decodeEvmDraft } from "@binference/plugin-sdk/evm";
import type { ChainSetup } from "../chain-setup.js";
import { readSwapCall } from "./swap-call.js";

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
  const effect =
    setup === undefined || !isTrade
      ? undefined
      : aggregatorEffectOf({ ...swap, fromToken: swap.srcToken, toToken: swap.dstToken }, setup);
  return effect === undefined ? err("unknown_call") : ok(effect);
}
