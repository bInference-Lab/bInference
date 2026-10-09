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
import { readDagCall } from "./dag-call.js";

/**
 * Reads what an OKX trade call does from the draft's bytes alone: the router's recipient, its
 * exact input, its minimum return and its deadline. A draft on a chain the venue does not trade
 * on, or a call that is not one of the router's plain DAG swaps, is `unknown_call`.
 */
export function decodeSwap(
  draft: TxDraft,
  setups: ReadonlyMap<ChainRef, ChainSetup>,
): Result<DecodedEffect, "unknown_call"> {
  const setup = setups.get(draft.chain);
  const call = decodeEvmDraft(draft);
  const dag = call.ok ? readDagCall(call.value.data, call.value.value, call.value.from) : undefined;
  const effect =
    setup === undefined || dag === undefined ? undefined : aggregatorEffectOf(dag, setup);
  return effect === undefined ? err("unknown_call") : ok(effect);
}
