import { aggregatorNativeToken } from "@binference/plugin-sdk/evm";
import { type Address, encodeFunctionData, type Hex, hexToBigInt, parseAbi } from "viem";

const routerAbi = parseAbi([
  "struct BaseRequest { uint256 fromToken; address toToken; uint256 fromTokenAmount; uint256 minReturnAmount; uint256 deadLine; }",
  "struct RouterPath { address[] mixAdapters; address[] assetTo; uint256[] rawData; bytes[] extraData; uint256 fromToken; }",
  "function dagSwapByOrderId(uint256 orderId, BaseRequest baseRequest, RouterPath[] paths) payable returns (uint256 returnAmount)",
  "function dagSwapTo(uint256 orderId, address receiver, BaseRequest baseRequest, RouterPath[] paths) payable returns (uint256 returnAmount)",
]);

/** One node of a route, as OKX's router takes it. */
interface RouterPath {
  readonly mixAdapters: readonly Address[];
  readonly assetTo: readonly Address[];
  readonly rawData: readonly bigint[];
  readonly extraData: readonly Hex[];
  readonly fromToken: bigint;
}

const usdt: Address = "0x55d398326f99059fF775485246999027B3197955";
const wbnb: Address = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const adapter: Address = "0x7A7AD9aa93cd0A2D0255326E5Fb145CEc14997FF";

/**
 * The route of a real sale of USDT for BNB through OKX's router on BSC (transaction
 * `0x6e3a4146…fe54c`): one node, USDT through one adapter to WBNB.
 */
export const salePaths: readonly RouterPath[] = [
  {
    mixAdapters: [adapter],
    assetTo: [adapter],
    rawData: [110_396_664_173_259_014_468_722_701_942_490_767_880_417_654_938_166_708n],
    extraData: [
      `0x${"0".repeat(126)}40${"0".repeat(62)}40${"0".repeat(24)}55d398326f99059ff775485246999027b3197955${"0".repeat(24)}bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c`,
    ],
    fromToken: hexToBigInt(usdt),
  },
];

/**
 * A one-node route from WBNB to USDT in the shape of {@link salePaths}, through the same adapter:
 * the route of a buy of USDT with BNB, which the router wraps into WBNB first.
 */
export const buyPaths: readonly RouterPath[] = [
  {
    mixAdapters: [adapter],
    assetTo: [adapter],
    rawData: [110_396_664_173_259_014_468_722_701_942_490_767_880_417_654_938_166_708n],
    extraData: [
      `0x${"0".repeat(126)}40${"0".repeat(62)}40${"0".repeat(24)}bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c${"0".repeat(24)}55d398326f99059ff775485246999027b3197955`,
    ],
    fromToken: hexToBigInt(wbnb),
  },
];

/** The terms of a DAG swap call to encode. */
export interface DagTerms {
  readonly fromToken: Address;
  readonly toToken: Address;
  readonly amount: bigint;
  readonly minReturn: bigint;
  readonly deadlineSec: bigint;
  readonly paths: readonly RouterPath[];
  /** Set for `dagSwapTo`; `dagSwapByOrderId` pays its sender. */
  readonly receiver?: Address;
  /** Raw words to put on the first node's `fromToken` above its address, such as a mode. */
  readonly modeBits?: bigint;
}

/** Encodes a DAG swap of OKX's router, as OKX's API encodes one. */
export function dagCallData(terms: DagTerms): Hex {
  const request = {
    fromToken: hexToBigInt(terms.fromToken),
    toToken: terms.toToken,
    fromTokenAmount: terms.amount,
    minReturnAmount: terms.minReturn,
    deadLine: terms.deadlineSec,
  };
  const paths = terms.paths.map((path, index) =>
    index === 0 ? { ...path, fromToken: path.fromToken | (terms.modeBits ?? 0n) } : path,
  );
  return terms.receiver === undefined
    ? encodeFunctionData({
        abi: routerAbi,
        functionName: "dagSwapByOrderId",
        args: [1n, request, paths],
      })
    : encodeFunctionData({
        abi: routerAbi,
        functionName: "dagSwapTo",
        args: [1n, terms.receiver, request, paths],
      });
}

/** OKX's router writes the chain's coin as this address. */
export const nativeToken: Address = aggregatorNativeToken;

/** USDT on BSC, as OKX's router writes it. */
export const usdtToken: Address = usdt;
