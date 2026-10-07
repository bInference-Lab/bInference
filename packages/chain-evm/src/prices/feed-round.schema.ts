import { decodeFunctionResult, encodeFunctionData, type Hex, parseAbi } from "viem";
import type { z } from "zod";
import { hexSchema } from "../rpc/evm-wire.schema.js";

/** What a Chainlink feed answered last: its USD answer and when the answer was updated. */
export interface FeedRound {
  /** The answer in the feed's own decimals; a broken feed can answer zero or less. */
  readonly answer: bigint;
  /** When the answer was updated, in seconds since the epoch; 0 for a round still open. */
  readonly updatedAtSeconds: bigint;
}

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

/** The call data of a feed proxy's `latestRoundData()`. */
export const latestRoundDataCall: Hex = encodeFunctionData({
  abi: feedAbi,
  functionName: "latestRoundData",
});

// Five 32-byte words: anything shorter or longer is not this function's answer.
const roundBytes = 5 * 32;

/** Reads `latestRoundData()`'s answer as an `eth_call` returns it. */
export const feedRoundSchema: z.ZodType<FeedRound, string> = hexSchema
  .refine((data) => data.length === 2 + roundBytes * 2)
  .transform((data): FeedRound => {
    const [, answer, , updatedAtSeconds] = decodeFunctionResult({
      abi: feedAbi,
      functionName: "latestRoundData",
      data,
    });
    return { answer, updatedAtSeconds };
  });
