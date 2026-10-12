import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  type Hex,
  parseAbi,
} from "viem";
import type { TokenState } from "./token-state.js";

// The parts of Flap's Portal the venue calls, as its verified implementation (v5.24.0) declares
// them and Flap's developer docs describe them ("Inspect A Token", "Trade Tokens").
// - `getTokenV8Safe`: a token's state, enums as `uint8`. It reverts with `TokenNotFound(token)` for
//   a token Flap never launched.
// - `quoteExactInput`: what an exact input buys now. It is no view, so it is read by `eth_call`.
//   For a token that left its curve it quotes the pool it moved to.
// - `swapExactInput`: the trade. The zero address stands for the chain's coin. It pays the caller,
//   reverts below `minOutputAmount`, and takes no deadline.
const portalAbi = parseAbi([
  "struct TokenStateV8Safe { uint8 status; uint256 reserve; uint256 circulatingSupply; uint256 price; uint8 tokenVersion; uint256 r; uint256 h; uint256 k; uint256 dexSupplyThresh; address quoteTokenAddress; bool nativeToQuoteSwapEnabled; bytes32 extensionID; uint256 buyTaxRate; uint256 sellTaxRate; address pool; uint256 progress; uint8 lpFeeProfile; uint8 dexId; }",
  "struct QuoteExactInputParams { address inputToken; address outputToken; uint256 inputAmount; }",
  "struct ExactInputParams { address inputToken; address outputToken; uint256 inputAmount; uint256 minOutputAmount; bytes permitData; }",
  "function getTokenV8Safe(address token) view returns (TokenStateV8Safe state)",
  "function quoteExactInput(QuoteExactInputParams params) returns (uint256 outputAmount)",
  "function swapExactInput(ExactInputParams params) payable returns (uint256 outputAmount)",
  "error TokenNotFound(address token)",
]);

/** One trade on the Portal: what goes in, how much, and what comes out. */
export interface PortalTrade {
  /** What the trade spends; the zero address for the chain's coin. */
  readonly inputToken: Address;
  /** What the trade buys; the zero address for the chain's coin. */
  readonly outputToken: Address;
  /** The exact input, in base units. */
  readonly inputAmount: bigint;
}

/** The arguments of a `swapExactInput` call. */
export interface SwapArgs extends PortalTrade {
  /** The least the Portal lets the caller receive, in base units. */
  readonly minOutputAmount: bigint;
  /** An ERC-2612 permit for the input; empty when the input was approved beforehand. */
  readonly permitData: Hex;
}

/** The Portal's `swapExactInput`, the one function the venue's trades call, as its JSON ABI. */
export const swapFunctionJson: JsonValue = callAbiJson(
  getAbiItem({ abi: portalAbi, name: "swapExactInput" }),
);

/** The calldata of `getTokenV8Safe(token)`. */
export function stateCallData(token: Address): Hex {
  return encodeFunctionData({ abi: portalAbi, functionName: "getTokenV8Safe", args: [token] });
}

/** Reads `getTokenV8Safe`'s answer; one outside its shape throws viem's decoding error. */
export function stateOf(data: Hex): TokenState {
  const state = decodeFunctionResult({ abi: portalAbi, functionName: "getTokenV8Safe", data });
  return {
    status: state.status,
    circulatingSupply: state.circulatingSupply,
    price: state.price,
    dexSupplyThresh: state.dexSupplyThresh,
    quoteToken: state.quoteTokenAddress,
    buyTaxBps: state.buyTaxRate,
    sellTaxBps: state.sellTaxRate,
  };
}

/** Whether revert data is the Portal's `TokenNotFound` naming this token. */
export function isTokenNotFound(data: Hex, token: Address): boolean {
  try {
    const decoded = decodeErrorResult({ abi: portalAbi, data });
    return decoded.errorName === "TokenNotFound" && decoded.args[0] === token;
  } catch {
    return false;
  }
}

/** The calldata of `quoteExactInput(trade)`. */
export function quoteCallData(trade: PortalTrade): Hex {
  return encodeFunctionData({ abi: portalAbi, functionName: "quoteExactInput", args: [trade] });
}

/** Reads `quoteExactInput`'s answer; one outside its shape throws viem's decoding error. */
export function quotedOut(data: Hex): bigint {
  return decodeFunctionResult({ abi: portalAbi, functionName: "quoteExactInput", data });
}

/** The calldata of `swapExactInput(args)`. */
export function swapCallData(args: SwapArgs): Hex {
  return encodeFunctionData({ abi: portalAbi, functionName: "swapExactInput", args: [args] });
}

/** The arguments of a `swapExactInput` call; undefined for any other calldata. */
export function swapArgsOf(data: Hex): SwapArgs | undefined {
  const decoded = decodeCall(portalAbi, data);
  return decoded.ok && decoded.value.functionName === "swapExactInput"
    ? decoded.value.args[0]
    : undefined;
}
