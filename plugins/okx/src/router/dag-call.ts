import { aggregatorNativeToken, decodeCall } from "@binference/plugin-sdk/evm";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  numberToHex,
  parseAbi,
  size,
  slice,
  zeroAddress,
} from "viem";

// The DAG swaps of OKX's DexRouter (DagRouter.sol and DexRouter.sol in okxlabs/DEX-Router-EVM-V1):
// the router pulls `fromTokenAmount` from the sender, routes it through the paths, pays the output
// to the receiver (the sender for `dagSwapByOrderId`), reverts unless the receiver gained at least
// `minReturnAmount` of `toToken`, and reverts after `deadLine`.
const routerAbi = parseAbi([
  "struct BaseRequest { uint256 fromToken; address toToken; uint256 fromTokenAmount; uint256 minReturnAmount; uint256 deadLine; }",
  "struct RouterPath { address[] mixAdapters; address[] assetTo; uint256[] rawData; bytes[] extraData; uint256 fromToken; }",
  "function dagSwapByOrderId(uint256 orderId, BaseRequest baseRequest, RouterPath[] paths) payable returns (uint256 returnAmount)",
  "function dagSwapTo(uint256 orderId, address receiver, BaseRequest baseRequest, RouterPath[] paths) payable returns (uint256 returnAmount)",
]);

/** The router's base request, as its ABI decodes it. */
interface BaseRequest {
  readonly fromToken: bigint;
  readonly toToken: Address;
  readonly fromTokenAmount: bigint;
  readonly minReturnAmount: bigint;
  readonly deadLine: bigint;
}

/** One node of the route, as the ABI decodes it. */
interface RouterPath {
  readonly mixAdapters: readonly Address[];
  readonly assetTo: readonly Address[];
  readonly rawData: readonly bigint[];
  readonly extraData: readonly Hex[];
  readonly fromToken: bigint;
}

/** A call to a DAG swap of OKX's router, read from its calldata, in the one shape the venue takes. */
export interface DagCall {
  /** What the call spends; `aggregatorNativeToken` for the chain's coin. */
  readonly fromToken: Address;
  /** What it buys; `aggregatorNativeToken` for the chain's coin. */
  readonly toToken: Address;
  /** The account the router pays and checks the output against. */
  readonly recipient: Address;
  /** The exact input, in base units. */
  readonly amount: bigint;
  /** The least the router lets the recipient receive, in base units. */
  readonly minReturn: bigint;
  /** Unix seconds; the router reverts after it. */
  readonly deadlineSec: bigint;
  /** The function and its arguments, which {@link withTerms} encodes again. */
  readonly call: DecodedDagCall;
}

type DecodedDagCall =
  | {
      readonly functionName: "dagSwapByOrderId";
      readonly args: readonly [bigint, BaseRequest, readonly RouterPath[]];
    }
  | {
      readonly functionName: "dagSwapTo";
      readonly args: readonly [bigint, Address, BaseRequest, readonly RouterPath[]];
    };

const addressBits = 160n;
// The router's transfer modes sit in bits 249 to 251 of a path's `fromToken`; 0 pulls the input
// from the sender through OKX's TokenApprove. The others pay from the router's own balance or
// through Permit2, which the venue never asks for.
const transferModeMask = 0x0en << 248n;
// The router reads commission and trim terms from the last words of the calldata when their first
// six bytes hold one of these flags (CommissionLib.sol). Each pays part of the trade to a third
// party, so a call that carries one is not read.
const feeFlags: ReadonlySet<string> = new Set([
  "0x3ca20afc2aaa",
  "0x3ca20afc2bbb",
  "0x22220afc2aaa",
  "0x22220afc2bbb",
  "0x88880afc2aaa",
  "0x88880afc2bbb",
  "0x777777771111",
  "0x777777772222",
]);

function baseRequestOf(call: DecodedDagCall): BaseRequest {
  return call.functionName === "dagSwapTo" ? call.args[2] : call.args[1];
}

function pathsOf(call: DecodedDagCall): readonly RouterPath[] {
  return call.functionName === "dagSwapTo" ? call.args[3] : call.args[2];
}

function encodeDagCall(call: DecodedDagCall): Hex {
  return call.functionName === "dagSwapTo"
    ? encodeFunctionData({ abi: routerAbi, functionName: "dagSwapTo", args: call.args })
    : encodeFunctionData({ abi: routerAbi, functionName: "dagSwapByOrderId", args: call.args });
}

// Nothing follows the arguments, and their last word sets none of the router's fee flags.
function isPlain(data: Hex, call: DecodedDagCall): boolean {
  const isWhole = encodeDagCall(call) === data.toLowerCase();
  return isWhole && !feeFlags.has(slice(data, size(data) - 32, size(data) - 26).toLowerCase());
}

// The input is a plain token address, the first node pulls it from the sender, and only the
// chain's coin travels as the call's value, exactly the input.
function spendsExactly(call: DecodedDagCall, value: bigint): boolean {
  const { fromToken, fromTokenAmount } = baseRequestOf(call);
  const [first] = pathsOf(call);
  const isSender = first !== undefined && (first.fromToken & transferModeMask) === 0n;
  const isAddress = fromToken >> addressBits === 0n;
  const isNative =
    isAddress && getAddress(numberToHex(fromToken, { size: 20 })) === aggregatorNativeToken;
  return isSender && isAddress && value === (isNative ? fromTokenAmount : 0n);
}

/**
 * Reads a DAG swap of OKX's router from calldata, the native value sent with it and its sender.
 * Any other function, calldata with bytes after the arguments or a fee flag in its last word, a
 * transfer mode other than a pull from the sender, a value other than the native input, or a
 * receiver at the zero address is undefined.
 */
export function readDagCall(data: Hex, value: bigint, sender: Address): DagCall | undefined {
  const decoded = decodeCall(routerAbi, data);
  if (!decoded.ok) {
    return undefined;
  }
  const call: DecodedDagCall = decoded.value;
  const receiver = call.functionName === "dagSwapTo" ? call.args[1] : sender;
  if (receiver === zeroAddress || !isPlain(data, call) || !spendsExactly(call, value)) {
    return undefined;
  }
  const request = baseRequestOf(call);
  return {
    fromToken: getAddress(numberToHex(request.fromToken, { size: 20 })),
    toToken: request.toToken,
    recipient: receiver,
    amount: request.fromTokenAmount,
    minReturn: request.minReturnAmount,
    deadlineSec: request.deadLine,
    call,
  };
}

/**
 * Encodes the call again with a new minimum return and deadline. The router checks both itself
 * after the route runs, so changing them changes nothing else the call does.
 */
export function withTerms(
  dag: DagCall,
  terms: { readonly minReturn: bigint; readonly deadlineSec: bigint },
): Hex {
  const { call } = dag;
  const request = {
    ...baseRequestOf(call),
    minReturnAmount: terms.minReturn,
    deadLine: terms.deadlineSec,
  };
  return call.functionName === "dagSwapTo"
    ? encodeDagCall({ ...call, args: [call.args[0], call.args[1], request, call.args[3]] })
    : encodeDagCall({ ...call, args: [call.args[0], request, call.args[2]] });
}
