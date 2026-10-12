import { isJsonNumber, parseJsonText } from "@binference/plugin-sdk/data";
import { z } from "zod";

/** One token of DEX Screener's boosts list, with the fields the source reads. */
export interface DexBoost {
  readonly chainId: string;
  readonly tokenAddress: string;
  /** The boosts active on the token now, as DEX Screener wrote the number. */
  readonly totalAmount: string | undefined;
}

const boostSchema = z.object({
  chainId: z.string().min(1),
  tokenAddress: z.string().min(1),
  totalAmount: z.string().refine(isJsonNumber).nullish(),
});

// The docs describe one item of the list; the endpoint answers a list of them.
const boostListSchema = z.array(boostSchema);

/**
 * Reads the answer of `GET /token-boosts/top/v1`: the tokens with the most active boosts, in
 * DEX Screener's order. An answer outside its documented item schema is undefined.
 */
export function readBoostList(text: string): readonly DexBoost[] | undefined {
  const answer = boostListSchema.safeParse(parseJsonText(text));
  return answer.success
    ? answer.data.map(({ chainId, tokenAddress, totalAmount }) => ({
        chainId,
        tokenAddress,
        totalAmount: totalAmount ?? undefined,
      }))
    : undefined;
}
