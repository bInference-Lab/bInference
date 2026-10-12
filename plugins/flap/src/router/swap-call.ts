import { type Hex, zeroAddress } from "viem";
import { type SwapArgs, swapArgsOf, swapCallData } from "../portal/portal-calls.js";

/** A call to the Portal's `swapExactInput`, in the one shape the venue builds and reads. */
export type SwapCall = Omit<SwapArgs, "permitData">;

/** Encodes a `swapExactInput` call with no permit: an input token is approved beforehand. */
export function encodeSwap(call: SwapCall): Hex {
  return swapCallData({ ...call, permitData: "0x" });
}

/**
 * Reads the Portal's `swapExactInput` from calldata and the native value sent with it. Any other
 * function, a call with permit data (it would sign away more than the step's approval), a trade of
 * one asset for itself, or a native value other than the coin input it spends is undefined.
 */
export function readSwapCall(data: Hex, value: bigint): SwapCall | undefined {
  const args = swapArgsOf(data);
  if (args === undefined) {
    return undefined;
  }
  const { inputToken, outputToken, inputAmount, minOutputAmount, permitData } = args;
  const sendsExactly = inputToken === zeroAddress ? value === inputAmount : value === 0n;
  if (permitData !== "0x" || inputToken === outputToken || !sendsExactly) {
    return undefined;
  }
  return { inputToken, outputToken, inputAmount, minOutputAmount };
}
