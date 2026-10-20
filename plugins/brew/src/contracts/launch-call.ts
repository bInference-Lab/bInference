import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  type Hex,
  parseAbi,
} from "viem";

// The parts of Brew's contracts a launch calls, as BrewFactory's and BrewDistributorFactory's
// verified sources declare them.
// - BrewFactory: `launch` (0x7cd1f68e), the one call that makes a token, its pool and its locked
//   liquidity, with an optional first buy; its launch fee and pause; and `predictTokenAddress`,
//   the address a launch's CREATE2 gives its token.
// - BrewDistributorFactory: `predict`, the holder distributor a token will get, which a launch
//   names as its creator fee recipient to route the creator's fees to the token's holders.
const factoryAbi = parseAbi([
  "struct LiquidityPosition { int24 tickLower; int24 tickUpper; uint16 bps; }",
  "struct LaunchParams { string name; string symbol; string metadataURI; uint256 totalSupply; address quoteToken; uint24 fee; int24 initialTick; LiquidityPosition[] positions; address creatorFeeRecipient; uint256 initialBuyQuoteAmount; uint256 initialBuyMinTokensOut; address initialBuyRecipient; bytes32 salt; uint256 maxLaunchFeeWei; }",
  "function launch(LaunchParams params) payable returns (address token, address pool, uint256[] positionIds)",
  "function launchFeeWei() view returns (uint256)",
  "function paused() view returns (bool)",
  "function predictTokenAddress(address creator, bytes32 salt, string name, string symbol, uint256 totalSupply, string metadataURI) view returns (address)",
]);

const distributorAbi = parseAbi(["function predict(address token) view returns (address)"]);

/** The JSON ABI entry of `launch`, the create call only a launch wallet makes. */
export const launchFunctionJson: JsonValue = callAbiJson(
  getAbiItem({ abi: factoryAbi, name: "launch" }),
);

/** One launch as BrewFactory's `launch` takes it. */
export interface LaunchParams {
  readonly name: string;
  readonly symbol: string;
  readonly metadataURI: string;
  readonly totalSupply: bigint;
  readonly quoteToken: Address;
  readonly fee: number;
  readonly initialTick: number;
  readonly positions: readonly {
    readonly tickLower: number;
    readonly tickUpper: number;
    readonly bps: number;
  }[];
  readonly creatorFeeRecipient: Address;
  readonly initialBuyQuoteAmount: bigint;
  readonly initialBuyMinTokensOut: bigint;
  readonly initialBuyRecipient: Address;
  readonly salt: Hex;
  readonly maxLaunchFeeWei: bigint;
}

/** The calldata of `launch` for the launch. */
export function launchCallData(params: LaunchParams): Hex {
  return encodeFunctionData({ abi: factoryAbi, functionName: "launch", args: [params] });
}

/**
 * The launch a `launch` call's calldata names, only when the calldata is exactly what
 * {@link launchCallData} writes for it, with no bytes after; any other calldata: undefined.
 */
export function readLaunchCall(data: Hex): LaunchParams | undefined {
  const call = decodeCall(factoryAbi, data);
  if (!call.ok || call.value.functionName !== "launch") {
    return undefined;
  }
  const [params] = call.value.args;
  return launchCallData(params).toLowerCase() === data.toLowerCase() ? params : undefined;
}

/** The calldata of the factory's launch fee. */
export const launchFeeData: Hex = encodeFunctionData({
  abi: factoryAbi,
  functionName: "launchFeeWei",
});

/** The calldata of the factory's pause of new launches. */
export const pausedData: Hex = encodeFunctionData({ abi: factoryAbi, functionName: "paused" });

/** What a token's predicted address commits to, besides the factory. */
export interface PredictedToken {
  readonly creator: Address;
  readonly salt: Hex;
  readonly name: string;
  readonly symbol: string;
  readonly totalSupply: bigint;
  readonly metadataURI: string;
}

/** The calldata of the factory's `predictTokenAddress` for a launch. */
export function predictTokenData(asked: PredictedToken): Hex {
  const { creator, salt, name, symbol, totalSupply, metadataURI } = asked;
  return encodeFunctionData({
    abi: factoryAbi,
    functionName: "predictTokenAddress",
    args: [creator, salt, name, symbol, totalSupply, metadataURI],
  });
}

/** The calldata of the distributor factory's `predict` for a token. */
export function predictDistributorData(token: Address): Hex {
  return encodeFunctionData({ abi: distributorAbi, functionName: "predict", args: [token] });
}

/** The launch fee's answer. */
export function launchFeeOf(data: Hex): bigint {
  return decodeFunctionResult({ abi: factoryAbi, functionName: "launchFeeWei", data });
}

/** The pause's answer. */
export function pausedOf(data: Hex): boolean {
  return decodeFunctionResult({ abi: factoryAbi, functionName: "paused", data });
}

/** An address answer, of `predictTokenAddress` or `predict`. */
export function addressAnswerOf(data: Hex): Address {
  return decodeFunctionResult({ abi: distributorAbi, functionName: "predict", data });
}
