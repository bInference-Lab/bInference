import { accountRefSchema, type DecodedEffect } from "@binference/chain";
import type { Address } from "viem";
import { z } from "zod";
import { type AggregatorChain, aggregatorAssetOf } from "./aggregator-token.js";

/** What an aggregator's router call does, as its decoder read it from the calldata. */
export interface AggregatorCall {
  /** The account the router pays and checks the output against. */
  readonly recipient: Address;
  /** What the call spends, as the aggregator writes it. */
  readonly fromToken: Address;
  /** The exact input, in base units. */
  readonly amount: bigint;
  /** What the call buys, as the aggregator writes it. */
  readonly toToken: Address;
  /** The least the router lets the recipient receive, in base units. */
  readonly minReturn: bigint;
  /** Unix seconds; the router reverts after it. */
  readonly deadlineSec: bigint;
}

// A millisecond count a number holds exactly; a later deadline does not fit one.
const deadlineMsSchema = z.coerce.number().int().nonnegative().max(9_007_199_254_740_991);

/**
 * The effect a venue's decoder reports for an aggregator's router call on the chain. A deadline
 * too far out to count in milliseconds is undefined, so the decoder reads the call as unknown.
 */
export function aggregatorEffectOf(
  call: AggregatorCall,
  on: AggregatorChain,
): DecodedEffect | undefined {
  const deadlineMs = deadlineMsSchema.safeParse((call.deadlineSec * 1000n).toString());
  if (!deadlineMs.success) {
    return undefined;
  }
  return {
    recipient: accountRefSchema.parse(`${on.chain}:${call.recipient}`),
    amountIn: { asset: aggregatorAssetOf(call.fromToken, on), base: call.amount },
    minOut: { asset: aggregatorAssetOf(call.toToken, on), base: call.minReturn },
    deadlineMs: deadlineMs.data,
  };
}
