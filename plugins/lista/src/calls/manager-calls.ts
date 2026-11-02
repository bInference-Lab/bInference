import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import { encodeFunctionData, type Hex, parseAbiItem } from "viem";

// Lista's stake manager's three user moves, from `synclub-contracts/contracts/ListaStakeManager.sol`.
// Each credits `msg.sender`: `deposit` mints slisBNB to the caller, `requestWithdraw` queues the
// caller's request, pulling the caller's slisBNB, and `claimWithdrawByUUID` pays the caller's own
// request with that id. No input names another account.
const depositAbi = parseAbiItem("function deposit() payable");
const requestAbi = parseAbiItem("function requestWithdraw(uint256 _amountInSlisBnb)");
const claimAbi = parseAbiItem("function claimWithdrawByUUID(uint256 _uuid)");
const callsAbi = [depositAbi, requestAbi, claimAbi] as const;

/** The JSON ABI entries the venue declares, in the order the chain registry lists them. */
export const managerCallsJson: readonly JsonValue[] = callsAbi.map(callAbiJson);

/** One of the three stake manager calls, read from its calldata. */
export type ManagerCall =
  | { readonly name: "deposit" }
  | { readonly name: "requestWithdraw"; readonly units: bigint }
  | { readonly name: "claimWithdrawByUUID"; readonly uuid: bigint };

/** `deposit`: the call's coin buys slisBNB for the caller. */
export function depositData(): Hex {
  return encodeFunctionData({ abi: [depositAbi] });
}

/** `requestWithdraw` of the slisBNB units, which the stake manager pulls from the caller. */
export function requestData(units: bigint): Hex {
  return encodeFunctionData({ abi: [requestAbi], args: [units] });
}

/** `claimWithdrawByUUID` of the caller's request with that id. */
export function claimData(uuid: bigint): Hex {
  return encodeFunctionData({ abi: [claimAbi], args: [uuid] });
}

/**
 * Reads calldata as one of the three calls, only in the exact bytes their ABI writes: another
 * function, such as `claimWithdraw` by index or the bot's `claimWithdrawFor`, bytes after the
 * arguments, or an argument padded another way is undefined.
 */
export function readManagerCall(data: Hex): ManagerCall | undefined {
  const call = decodeCall(callsAbi, data);
  if (!call.ok || encodeFunctionData({ abi: callsAbi, ...call.value }) !== data.toLowerCase()) {
    return undefined;
  }
  const { value } = call;
  if (value.functionName === "deposit") {
    return { name: "deposit" };
  }
  return value.functionName === "requestWithdraw"
    ? { name: value.functionName, units: value.args[0] }
    : { name: value.functionName, uuid: value.args[0] };
}
