import type { LaunchLog } from "@binference/plugin-sdk";
import { decodeLog } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isHex,
  parseAbi,
  toEventSelector,
} from "viem";

// The events a Genius.fun launch writes, as the verified sources declare them.
// - A stack's factory: `TokenLaunched` for each launch, with its curve, its deployer (the wallet
//   that launched it, also through the router) and the token its curve trades against;
//   `LaunchSwept` once its curve sold out, `PoolGraduated` once its pool exists.
// - The launch's curve: `SnipeTaxExempted` for each wallet the launch exempted, in its own
//   transaction.
const launchEvents = parseAbi([
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "event SnipeTaxExempted(address indexed account)",
  "event LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)",
  "event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)",
]);

// A launch's curve as the launch feed reads it, from the verified source: the creator tax and the
// launch window's starting snipe tax it took at launch, the supply it launched with, the tokens it
// keeps for its pool, the tokens it still sells, and whether it graduated.
const curveAbi = parseAbi([
  "function creatorTaxBps() view returns (uint256)",
  "function snipeTaxStartBps() view returns (uint256)",
  "function launchSupply() view returns (uint256)",
  "function reservedTokens() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function graduated() view returns (bool)",
]);

/** The ids of the launch events the launch feed reads, as lowercase topic0 hex. */
export const launchEventIds: readonly string[] = launchEvents.map((event) =>
  toEventSelector(event).toLowerCase(),
);

/** One launch event the venue reads, with its log's index. */
export type LaunchEvent = { readonly index: number } & (
  | {
      readonly kind: "launched";
      readonly token: Address;
      readonly curve: Address;
      readonly creator: Address;
      readonly pairToken: Address;
    }
  | { readonly kind: "exempted"; readonly account: Address }
  | { readonly kind: "graduated"; readonly token: Address }
);

/** A log as one of the launch events the venue reads; any other is undefined. */
export function launchEventOf(log: LaunchLog): LaunchEvent | undefined {
  const event = decodeLog(launchEvents, log);
  const { index } = log;
  if (event === undefined) {
    return undefined;
  }
  if (event.eventName === "TokenLaunched") {
    const { token, curve, deployer, pairToken } = event.args;
    return { kind: "launched", index, token, curve, creator: deployer, pairToken };
  }
  if (event.eventName === "SnipeTaxExempted") {
    return { kind: "exempted", index, account: event.args.account };
  }
  return { kind: "graduated", index, token: event.args.token };
}

const curveReads = [
  "creatorTaxBps",
  "snipeTaxStartBps",
  "launchSupply",
  "reservedTokens",
  "sellableTokens",
  "graduated",
] as const;

/**
 * The calldata of the curve's reads that complete a launch: its creator tax, starting snipe tax,
 * launch supply, reserved tokens, sellable tokens and `graduated()`, in that order.
 */
export const curveFactCalls: readonly Hex[] = curveReads.map((functionName) =>
  encodeFunctionData({ abi: curveAbi, functionName }),
);

/** The calldata of the token's `symbol()` and `name()`, in that order. */
export const tokenWordCalls: readonly Hex[] = [
  encodeFunctionData({ abi: erc20Abi, functionName: "symbol" }),
  encodeFunctionData({ abi: erc20Abi, functionName: "name" }),
];

/** A curve's one-number answer; one that failed or falls outside a `uint256` is undefined. */
export function curveNumberOf(data: string | undefined): bigint | undefined {
  try {
    return data !== undefined && isHex(data)
      ? decodeFunctionResult({ abi: curveAbi, functionName: "launchSupply", data })
      : undefined;
  } catch {
    return undefined;
  }
}

/** The curve's `graduated()` answer; one that failed or falls outside a `bool` is undefined. */
export function curveGraduatedOf(data: string | undefined): boolean | undefined {
  try {
    return data !== undefined && isHex(data)
      ? decodeFunctionResult({ abi: curveAbi, functionName: "graduated", data })
      : undefined;
  } catch {
    return undefined;
  }
}

/** A token's `symbol()` or `name()` answer; one that failed or is no string is undefined. */
export function tokenWordOf(data: string | undefined): string | undefined {
  try {
    return data !== undefined && isHex(data)
      ? decodeFunctionResult({ abi: erc20Abi, functionName: "name", data })
      : undefined;
  } catch {
    return undefined;
  }
}
