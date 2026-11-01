import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import { type Address, encodeFunctionData, type Hex, parseAbiItem } from "viem";

// StakeHub's three user moves, from `bsc-genesis-contract/contracts/StakeHub.sol`. Each credits
// `msg.sender`: the delegator is the caller in `delegate`, `undelegate` and `claim`, and no input
// names another account. `operatorAddress` names a validator, credited nothing.
const delegateAbi = parseAbiItem(
  "function delegate(address operatorAddress, bool delegateVotePower) payable",
);
const undelegateAbi = parseAbiItem("function undelegate(address operatorAddress, uint256 shares)");
const claimAbi = parseAbiItem("function claim(address operatorAddress, uint256 requestNumber)");
const callsAbi = [delegateAbi, undelegateAbi, claimAbi] as const;

/** The JSON ABI entries the venue declares, in the order the chain registry lists them. */
export const stakeCallsJson: readonly JsonValue[] = callsAbi.map(callAbiJson);

/** One of the three StakeHub calls, read from its calldata. */
export type StakeCall =
  | { readonly name: "delegate"; readonly validator: Address; readonly votes: boolean }
  | {
      readonly name: "undelegate" | "claim";
      readonly validator: Address;
      /** The shares an `undelegate` burns, or the parts a `claim` takes. */
      readonly count: bigint;
    };

/**
 * `delegate` to the validator, never handing it the wallet's governance votes: the stake earns the
 * same either way, and binference casts no vote for the owner.
 */
export function delegateData(validator: Address): Hex {
  return encodeFunctionData({ abi: [delegateAbi], args: [validator, false] });
}

/** `undelegate` the receipt token units from the validator. */
export function undelegateData(validator: Address, shares: bigint): Hex {
  return encodeFunctionData({ abi: [undelegateAbi], args: [validator, shares] });
}

/** `claim` the oldest unbonding parts from the validator, as many as `parts`. */
export function claimData(validator: Address, parts: bigint): Hex {
  return encodeFunctionData({ abi: [claimAbi], args: [validator, parts] });
}

/**
 * Reads calldata as one of the three calls, only in the exact bytes their ABI writes: another
 * function, bytes after the arguments, or an argument padded another way is undefined.
 */
export function readStakeCall(data: Hex): StakeCall | undefined {
  const call = decodeCall(callsAbi, data);
  if (!call.ok || encodeFunctionData({ abi: callsAbi, ...call.value }) !== data.toLowerCase()) {
    return undefined;
  }
  const { functionName, args } = call.value;
  return functionName === "delegate"
    ? { name: functionName, validator: args[0], votes: args[1] }
    : { name: functionName, validator: args[0], count: args[1] };
}
