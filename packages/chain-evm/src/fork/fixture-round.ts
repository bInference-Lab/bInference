import { encodeAbiParameters, type Hex, parseAbiParameters } from "viem";

/** One round a fixture feed answers: its USD answer and its update time. */
export interface FixtureRound {
  readonly answer: bigint;
  readonly updatedAtSeconds: bigint;
}

const roundParameters = parseAbiParameters("uint80, int256, uint256, uint256, uint80");

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * Runtime code for a feed aggregator that answers every call with one round, as
 * `latestRoundData()` returns it. Set at the aggregator behind a feed's proxy with
 * `anvil_setCode`, it changes the feed's answer while the proxy still serves the read.
 */
export function encodeFixtureRound(round: FixtureRound): Hex {
  const data = encodeAbiParameters(roundParameters, [
    1n,
    round.answer,
    round.updatedAtSeconds,
    round.updatedAtSeconds,
    1n,
  ]);
  const words = data.slice(2).match(/.{64}/g) ?? [];
  // PUSH32 word, PUSH1 offset, MSTORE for each word; then RETURN the five words from offset 0.
  const stores = words.map((word, index) => `7f${word}60${hexByte(index * 32)}52`);
  return `0x${stores.join("")}60${hexByte(words.length * 32)}6000f3`;
}
