import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
  type LaunchpadVenue,
  type QuoteRequest,
} from "@binference/plugin-sdk";
import { curveChainSetupsOf, type RpcFailover } from "@binference/plugin-sdk/evm";
import { type Address, encodeAbiParameters, type Hex } from "viem";
import {
  launchCallData,
  launchFactoryCallData,
  launchPhase,
  type LaunchRecord,
  sellableCallData,
  snipeTaxCallData,
} from "../contracts/genius-calls.js";
import { createGeniusfunVenue } from "../geniusfun-venue.js";
import { createBoundedMemo } from "../launch/bounded-memo.js";
import type { VenueParts } from "../venue-parts.js";
import type { RecordedCall } from "./recorded-answers.js";

/** BSC, the chain the answers were recorded on. */
export const bscChain: ChainRef = chainRefSchema.parse("eip155:56");

/** BNB, BSC's own coin. */
export const bnb: AssetRef = assetRefSchema.parse("eip155:56/slip44:714");

const erc20 = (address: Address): AssetRef => assetRefSchema.parse(`${bscChain}/erc20:${address}`);
const account = (address: Address): AccountRef => accountRefSchema.parse(`${bscChain}:${address}`);

/** USDT on BSC, a quote token Genius.fun's curves may trade against. */
export const usdt: AssetRef = erc20("0x55d398326f99059fF775485246999027B3197955");

/** USDC on BSC, a quote token Genius.fun's curves may trade against. */
export const usdc: AssetRef = erc20("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");

/** A token on its m4.2 curve against BNB, launched on 2026-10-14, its creator exempt. */
export const stackToken: AssetRef = erc20("0x7D227534c39C41033Af86DBC8aDE1BF8D68b0157");
/** The curve of {@link stackToken}'s launch. */
export const stackCurve: Address = "0x1A3f3cf9de26982B6620366591Dc145a2E657c7a";

/** A token on its m4.1 curve against BNB, launched on 2026-09-19. */
export const olderToken: AssetRef = erc20("0x4b8f01455c13e872d6910f728cF953db87ed68Bc");
/** The curve of {@link olderToken}'s launch. */
export const olderCurve: Address = "0x1a3AB1c7Aef910dfB7Cf968ae71D914C2B55BEFA";

/** A token on its m4.2 curve against another launch's token, which the venue does not serve. */
export const otherPairToken: AssetRef = erc20("0xDA8c681c59dA8a1aBEF486514e86004E4BEF8fCB");
/** The curve of {@link otherPairToken}'s launch. */
export const otherPairCurve: Address = "0xeb30C520B3400545b6F7F05634ac8cEA18Fb8572";
/** The token {@link otherPairToken}'s curve trades against. */
export const otherQuote: AssetRef = erc20("0x1F12B85aAC097E43Aa1555b2881E98a51090e9A6");

/** An m4.2 token whose launch graduated into its pool. */
export const graduatedToken: AssetRef = erc20("0x5C9Ff301Ec2d882B635813739cC07330788d7322");

/** The creator of {@link stackToken}, which its launch exempted from its snipe tax. */
export const stackCreator: AccountRef = account("0xf31af6202B50A51cc1F98426b66dBfc5fCBEafF9");
/** The creator of {@link olderToken}, which its launch exempted from its snipe tax. */
export const olderCreator: AccountRef = account("0x51A28DF7321513B9Ed7e3737C274608beC80EEe3");

/** The wallet the recorded trades are quoted for. */
export const recordedWallet: AccountRef = account("0x000000000000000000000000000000000000bEEF");
const walletAddress: Address = "0x000000000000000000000000000000000000bEEF";

/** The venue's registry contracts on BSC, as the host gives them with a request. */
export const registryContracts: Readonly<Record<string, AccountRef>> = {
  "factory-m4-2": account("0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37"),
  "factory-m4-1": account("0x78EAE9537C0ef90DFe9B7ae964682Fe8138afe31"),
};

/** The registry contracts with a launch's curve, as the host gives them for that launch's token. */
export function contractsWith(curve: Address): Readonly<Record<string, AccountRef>> {
  return { ...registryContracts, curve: account(curve) };
}

/** The Genius.fun venue on BSC over a failover, serving USDT and USDC besides BNB. */
export function venueOver(rpc: RpcFailover): LaunchpadVenue {
  return createGeniusfunVenue({
    chains: [{ chain: bscChain, nativeAsset: bnb, quoteTokens: [usdt, usdc], rpc }],
  });
}

/** A quote request for the recorded wallet, spending `amountIn` on `assetOut` through `curve`. */
export function requestOf(
  amountIn: QuoteRequest["amountIn"],
  assetOut: AssetRef,
  curve: Address = stackCurve,
): QuoteRequest {
  return { wallet: recordedWallet, amountIn, assetOut, contracts: contractsWith(curve) };
}

/**
 * The answer of a curve's `currentSnipeTaxBps` for the recorded wallet set to `bps`, as a launch
 * in its first seconds would give it, keyed as the recorded answers are.
 */
export function snipeTaxAnswer(curve: Address, bps: bigint): readonly [string, RecordedCall] {
  const result: Hex = encodeAbiParameters([{ type: "uint256" }], [bps]);
  return [`${curve.toLowerCase()}|${snipeTaxCallData(walletAddress)}`, { result }];
}

const launchRecordType = [
  {
    type: "tuple",
    components: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
      { name: "deployer", type: "address" },
      { name: "creatorFeeRecipient", type: "address" },
      { name: "pairToken", type: "address" },
      { name: "graduationThreshold", type: "uint256" },
      { name: "poolFee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "creatorTaxBps", type: "uint16" },
      { name: "buybackEnabled", type: "bool" },
      { name: "phase", type: "uint8" },
      { name: "sweptQuote", type: "uint256" },
      { name: "sweptTokens", type: "uint256" },
      { name: "sweptAt", type: "uint256" },
      { name: "exists", type: "bool" },
    ],
  },
] as const;

/** The venue's shared parts on BSC over a failover, for the tests of its steps. */
export function partsOver(rpc: RpcFailover): VenueParts {
  return {
    setups: curveChainSetupsOf(
      [{ chain: bscChain, nativeAsset: bnb, quoteTokens: [usdt, usdc], rpc }],
      { id: "geniusfun", name: "Genius.fun" },
    ),
    launches: createBoundedMemo(16),
    insiders: createBoundedMemo(16),
  };
}

/** A launch record a factory could give, for the answers a test writes itself. */
export type LaunchAnswer = Pick<LaunchRecord, "token" | "curve" | "pairToken"> &
  Partial<Pick<LaunchRecord, "phase" | "creatorTaxBps">>;

/**
 * A factory's answer to `getLaunchedToken(token)` naming a launch that exists, keyed as the
 * recorded answers are, for a state no recording holds.
 */
export function launchAnswer(
  factory: Address,
  launch: LaunchAnswer & { readonly exists?: boolean },
): readonly [string, RecordedCall] {
  const result: Hex = encodeAbiParameters(launchRecordType, [
    {
      token: launch.token,
      curve: launch.curve,
      deployer: walletAddress,
      creatorFeeRecipient: walletAddress,
      pairToken: launch.pairToken,
      graduationThreshold: 10n ** 22n,
      poolFee: 0,
      tickSpacing: 200,
      creatorTaxBps: Number(launch.creatorTaxBps ?? 0n),
      buybackEnabled: true,
      phase: launch.phase ?? launchPhase.notGraduated,
      sweptQuote: 0n,
      sweptTokens: 0n,
      sweptAt: 0n,
      exists: launch.exists ?? true,
    },
  ]);
  return [`${factory.toLowerCase()}|${launchCallData(launch.token)}`, { result }];
}

/** A token's answer to `launchFactory()`: a revert, as a token with no such view gives. */
export function noLaunchFactoryAnswer(token: Address): readonly [string, RecordedCall] {
  return [`${token.toLowerCase()}|${launchFactoryCallData}`, { revert: "0x" }];
}

/** A token's answer to `launchFactory()`, naming `factory`. */
export function launchFactoryAnswer(
  token: Address,
  factory: Address,
): readonly [string, RecordedCall] {
  const result: Hex = encodeAbiParameters([{ type: "address" }], [factory]);
  return [`${token.toLowerCase()}|${launchFactoryCallData}`, { result }];
}

/** A curve's answer to `sellableTokens()`, as a curve ready to graduate gives 0. */
export function sellableAnswer(curve: Address, sellable: bigint): readonly [string, RecordedCall] {
  const result: Hex = encodeAbiParameters([{ type: "uint256" }], [sellable]);
  return [`${curve.toLowerCase()}|${sellableCallData}`, { result }];
}
