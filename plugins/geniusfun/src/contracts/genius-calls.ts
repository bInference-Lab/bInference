import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  type Hex,
  parseAbi,
  toEventSelector,
} from "viem";

// The parts of Genius.fun's contracts the venue calls, as the ABIs genius.fun ships (4.1.0 and
// 4.2.0, the same for these) and the verified sources declare them.
// - A stack's factory: `getLaunchedToken`, the record of one launch, its curve among it.
// - A launched token: `launchFactory`, the factory that says it made the token.
// - A launch's curve: its reserves, fee, sellable tokens, the snipe tax a recipient pays now and
//   the second it launched; `buy` and `sell`, which take the recipient and no deadline.
const factoryAbi = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken launch)",
]);

const tokenAbi = parseAbi(["function launchFactory() view returns (address factory)"]);

const curveAbi = parseAbi([
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function feeBps() view returns (uint256 fee)",
  "function sellableTokens() view returns (uint256 sellable)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256 snipeTax)",
  "function launchedAt() view returns (uint256 launchedAt)",
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "event SnipeTaxExempted(address indexed account)",
]);

/** A launch's phase as its stack's factory records it. */
export const launchPhase = { notGraduated: 0, swept: 1, poolCreated: 2, rescued: 3 } as const;

/** What the venue reads of one launch from its stack's factory. */
export interface LaunchRecord {
  readonly token: Address;
  /** The launch's own curve, which trades the token until it graduates. */
  readonly curve: Address;
  /** The wallet that launched the token. */
  readonly deployer: Address;
  readonly creatorFeeRecipient: Address;
  /** What the curve trades the token against; the zero address for the chain's coin. */
  readonly pairToken: Address;
  /** The tax the curve takes for the creator on each trade, in basis points. */
  readonly creatorTaxBps: bigint;
  /** One of {@link launchPhase}. */
  readonly phase: number;
  /** Whether the factory made the token at all. */
  readonly exists: boolean;
}

/** A curve's reserves: the quote asset, its virtual part included, and the token. */
export interface CurveReserves {
  readonly quoteReserve: bigint;
  readonly tokenReserve: bigint;
}

/** One trade call on a curve: a buy spends the quote asset, a sale the token. */
export interface CurveTradeCall {
  readonly side: "buy" | "sell";
  /** The exact input, in base units. */
  readonly amountIn: bigint;
  /** The least the curve may pay, in base units of the output. */
  readonly minOut: bigint;
  /** Who the curve pays. */
  readonly recipient: Address;
}

/** The curve's `buy` and `sell`, the functions the venue's trades call, as JSON ABI entries. */
export const tradeFunctionsJson: { readonly buy: JsonValue; readonly sell: JsonValue } = {
  buy: callAbiJson(getAbiItem({ abi: curveAbi, name: "buy" })),
  sell: callAbiJson(getAbiItem({ abi: curveAbi, name: "sell" })),
};

/** The first topic of the curve's `SnipeTaxExempted(account)`, emitted only by its launch. */
export const snipeTaxExemptedTopic: Hex = toEventSelector(
  getAbiItem({ abi: curveAbi, name: "SnipeTaxExempted" }),
);

/** The calldata of a factory's `getLaunchedToken(token)`. */
export function launchCallData(token: Address): Hex {
  return encodeFunctionData({ abi: factoryAbi, functionName: "getLaunchedToken", args: [token] });
}

/** Reads `getLaunchedToken`'s answer; one outside its shape throws viem's decoding error. */
export function launchRecordOf(data: Hex): LaunchRecord {
  const launch = decodeFunctionResult({ abi: factoryAbi, functionName: "getLaunchedToken", data });
  return {
    token: launch.token,
    curve: launch.curve,
    deployer: launch.deployer,
    creatorFeeRecipient: launch.creatorFeeRecipient,
    pairToken: launch.pairToken,
    creatorTaxBps: BigInt(launch.creatorTaxBps),
    phase: launch.phase,
    exists: launch.exists,
  };
}

/** The calldata of a token's `launchFactory()`. */
export const launchFactoryCallData: Hex = encodeFunctionData({
  abi: tokenAbi,
  functionName: "launchFactory",
});

/** Reads `launchFactory()`'s answer; one outside its shape throws viem's decoding error. */
export function launchFactoryOf(data: Hex): Address {
  return decodeFunctionResult({ abi: tokenAbi, functionName: "launchFactory", data });
}

/** The calldata of a curve's `getReserves()`. */
export const reservesCallData: Hex = encodeFunctionData({
  abi: curveAbi,
  functionName: "getReserves",
});

/** Reads `getReserves()`'s answer; one outside its shape throws viem's decoding error. */
export function reservesOf(data: Hex): CurveReserves {
  const [quoteReserve, tokenReserve] = decodeFunctionResult({
    abi: curveAbi,
    functionName: "getReserves",
    data,
  });
  return { quoteReserve, tokenReserve };
}

/** The calldata of a curve's `feeBps()`. */
export const feeCallData: Hex = encodeFunctionData({ abi: curveAbi, functionName: "feeBps" });

/** The calldata of a curve's `sellableTokens()`. */
export const sellableCallData: Hex = encodeFunctionData({
  abi: curveAbi,
  functionName: "sellableTokens",
});

/** The calldata of a curve's `launchedAt()`. */
export const launchedAtCallData: Hex = encodeFunctionData({
  abi: curveAbi,
  functionName: "launchedAt",
});

/** The calldata of a curve's `currentSnipeTaxBps(recipient)`. */
export function snipeTaxCallData(recipient: Address): Hex {
  return encodeFunctionData({
    abi: curveAbi,
    functionName: "currentSnipeTaxBps",
    args: [recipient],
  });
}

/**
 * Reads the answer of one of the curve's one-number reads (`feeBps`, `sellableTokens`,
 * `currentSnipeTaxBps`, `launchedAt`); one outside a `uint256` throws viem's decoding error.
 */
export function numberOf(data: Hex): bigint {
  return decodeFunctionResult({ abi: curveAbi, functionName: "sellableTokens", data });
}

/** The calldata of a curve's `buy` or `sell`. */
export function tradeCallData(call: CurveTradeCall): Hex {
  const args = [call.amountIn, call.minOut, call.recipient] as const;
  return encodeFunctionData({ abi: curveAbi, functionName: call.side, args });
}

/** The trade a curve's `buy` or `sell` calldata asks for; undefined for any other calldata. */
export function tradeCallOf(data: Hex): CurveTradeCall | undefined {
  const decoded = decodeCall(curveAbi, data);
  if (!decoded.ok) {
    return undefined;
  }
  const { functionName, args } = decoded.value;
  if (functionName !== "buy" && functionName !== "sell") {
    return undefined;
  }
  const [amountIn, minOut, recipient] = args;
  return { side: functionName, amountIn, minOut, recipient };
}
