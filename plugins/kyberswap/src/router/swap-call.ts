import { aggregatorNativeToken, decodeCall } from "@binference/plugin-sdk/evm";
import { type Address, encodeFunctionData, type Hex, parseAbi, zeroAddress } from "viem";
import { readExecutorPayload } from "./executor-payload.js";

// The `swap` function of KyberSwap's MetaAggregationRouterV2, from its verified source. The router
// moves the input to the executor, calls the executor with `targetData`, then reverts unless
// `dstReceiver` gained at least `minReturnAmount` of `dstToken`.
const routerAbi = parseAbi([
  "struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }",
  "struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }",
  "function swap(SwapExecutionParams execution) payable returns (uint256 returnAmount, uint256 gasUsed)",
]);

// The router's own flags, bits 0 to 8 in its source: partial fill, extra native coin, claim, two
// burns, the mode that pays the first pools directly, fee on the output, fee in basis points and
// approving a target. Each changes what the call spends or pays, so a call with one is not read.
const routerFlags = 0x1ffn;

/** The router's swap description, as its ABI decodes it. */
interface SwapDescription {
  readonly srcToken: Address;
  readonly dstToken: Address;
  readonly srcReceivers: readonly Address[];
  readonly srcAmounts: readonly bigint[];
  readonly feeReceivers: readonly Address[];
  readonly feeAmounts: readonly bigint[];
  readonly dstReceiver: Address;
  readonly amount: bigint;
  readonly minReturnAmount: bigint;
  readonly flags: bigint;
  readonly permit: Hex;
}

/** The argument of the router's `swap`, as its ABI decodes it. */
interface SwapExecution {
  readonly callTarget: Address;
  readonly approveTarget: Address;
  readonly targetData: Hex;
  readonly desc: SwapDescription;
  readonly clientData: Hex;
}

/** A call to the router's `swap`, read from its calldata, in the one shape the venue accepts. */
export interface SwapCall {
  /** The contract the router calls with the executor data. */
  readonly executor: Address;
  /** What the call spends; `aggregatorNativeToken` for the chain's coin. */
  readonly srcToken: Address;
  /** What the call buys; `aggregatorNativeToken` for the chain's coin. */
  readonly dstToken: Address;
  /** The account the router checks the output against, and the executor pays. */
  readonly recipient: Address;
  /** The exact input, in base units. */
  readonly amount: bigint;
  /** The least the router lets the recipient receive, in base units. */
  readonly minReturn: bigint;
  /** Unix seconds; the executor reverts after it. */
  readonly deadlineSec: bigint;
  /** The decoded argument, which {@link withMinReturn} encodes again. */
  readonly execution: SwapExecution;
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

// The call spends exactly `amount`: as its native value, or as the token amounts it moves.
function spendsExactly(desc: SwapDescription, value: bigint): boolean {
  if (desc.srcReceivers.length !== desc.srcAmounts.length) {
    return false;
  }
  return desc.srcToken === aggregatorNativeToken
    ? value === desc.amount && desc.srcReceivers.length === 0
    : value === 0n && sum(desc.srcAmounts) === desc.amount;
}

// It takes no fee, signs no permit, approves no target and sets none of the router's own flags.
function isPlain(execution: SwapExecution): boolean {
  const { desc } = execution;
  const takesFee = desc.feeReceivers.length > 0 || desc.feeAmounts.length > 0;
  const hasExtras = desc.permit !== "0x" || execution.approveTarget !== zeroAddress;
  return !takesFee && !hasExtras && (desc.flags & routerFlags) === 0n;
}

/**
 * Reads the router's `swap` call from calldata and the native value sent with it. Any other
 * function, a call that is not plain (a fee, a permit, a router flag, an input it does not spend
 * exactly), or executor data whose recipient is not the router's recipient is undefined.
 */
export function readSwapCall(data: Hex, value: bigint): SwapCall | undefined {
  const call = decodeCall(routerAbi, data);
  if (!call.ok || call.value.functionName !== "swap") {
    return undefined;
  }
  const [execution] = call.value.args;
  const { desc } = execution;
  const payload = readExecutorPayload(execution.targetData);
  const isRead = payload !== undefined && payload.recipient === desc.dstReceiver;
  const isPlainCall = isPlain(execution) && spendsExactly(desc, value);
  if (!isRead || desc.dstReceiver === zeroAddress || !isPlainCall) {
    return undefined;
  }
  return {
    executor: execution.callTarget,
    srcToken: desc.srcToken,
    dstToken: desc.dstToken,
    recipient: desc.dstReceiver,
    amount: desc.amount,
    minReturn: desc.minReturnAmount,
    deadlineSec: payload.deadlineSec,
    execution,
  };
}

/**
 * Encodes the call again with a new minimum return. The router reads the minimum outside the
 * executor's signed payload, so raising it changes nothing else the call does.
 */
export function withMinReturn(call: SwapCall, minReturn: bigint): Hex {
  const { execution } = call;
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "swap",
    args: [{ ...execution, desc: { ...execution.desc, minReturnAmount: minReturn } }],
  });
}
