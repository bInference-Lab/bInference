import type { JsonValue } from "@binference/plugin-sdk";
import { callAbiJson, decodeCall } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  type Hex,
  parseAbi,
  zeroAddress,
} from "viem";
import { type GeniusRead, readCall } from "./read-genius.js";

// The parts of Genius.fun's m4.2 stack a launch calls, as the 4.2.0 ABIs genius.fun publishes
// (genius.fun/docs/integrate) and the verified sources declare them.
// - The stack's factory: its launch fee, whether launches are open and to whom, which tokens a
//   curve may trade against, the economics digest a launch commits to, and `launchToken` with the
//   Foundation choice (0xe78b4707), which makes a token and its curve.
// - The launch-and-buy router: `launchAndBuy` with the Foundation choice (0x71b27635), which makes
//   the token through the factory and runs its first buy on the new curve in the same call.
const paramsTypes = [
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
] as const;

const factoryLaunchAbi = parseAbi([
  ...paramsTypes,
  "function launchToken(TokenParams params, uint256 configId, address pairToken, bool toFoundation) payable returns (address token, address curve)",
  "function launchFee() view returns (uint256 fee)",
  "function launchEnabled() view returns (bool enabled)",
  "function canLaunch(address launcher) view returns (bool allowed)",
  "function approvedPairTokens(address pairToken) view returns (bool approved)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32 digest)",
]);

const routerAbi = parseAbi([
  ...paramsTypes,
  "function launchAndBuy(TokenParams params, uint256 configId, address pairToken, uint256 quoteIn, uint256 minimum, address recipient, bool toFoundation) payable returns (address token, address curve, uint256 tokensOut)",
]);

// The create overloads this venue never builds: the router's `launchAndBuy` without the
// Foundation choice, with exemptions, or with both, and the factory's `launchToken` likewise. Each
// is a launch wallet's alone too, so no other wallet can make a token through them.
const otherRouterCreates = parseAbi([
  ...paramsTypes,
  "function launchAndBuy(TokenParams params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (address token, address curve, uint256 tokensOut)",
  "function launchAndBuy(TokenParams params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)",
  "function launchAndBuy(TokenParams params, uint256 configId, address pairToken, uint256 quoteIn, uint256 minimum, address recipient, bool toFoundation, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)",
]);

const otherFactoryCreates = parseAbi([
  ...paramsTypes,
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)",
  "function launchToken(TokenParams params, uint256 configId, address pairToken, bool toFoundation, address[] snipeTaxExemptions) payable returns (address token, address curve)",
]);

/** A launch's social links as the token keeps them. */
interface TokenSocials {
  readonly twitter: string;
  readonly telegram: string;
  readonly discord: string;
  readonly website: string;
  readonly farcaster: string;
}

/** The token a launch makes, its words and its creator's terms, as `TokenParams` writes them. */
interface TokenParams {
  readonly name: string;
  readonly symbol: string;
  /** The picture's address, at most 512 bytes. */
  readonly logo: string;
  readonly description: string;
  readonly socials: TokenSocials;
  /** Who receives the creator's share of every trade's fee. */
  readonly creatorFeeRecipient: Address;
  readonly creatorTaxBps: number;
  readonly buybackEnabled: boolean;
  /** The factory's digest of the curve terms the launch commits to. */
  readonly expectedEconomics: Hex;
  readonly salt: Hex;
}

/** What every create call names: the token, the launch configuration, the pair and the destination. */
interface CreateBase {
  readonly params: TokenParams;
  readonly configId: bigint;
  /** The zero address for the chain's coin. */
  readonly pairToken: Address;
  /** Whether the destination share of the fee goes to the Genius Foundation's vault for good. */
  readonly toFoundation: boolean;
}

/** A create call of the m4.2 stack: a launch alone, or a launch with its first buy. */
export type CreateCall =
  | ({ readonly kind: "launch" } & CreateBase)
  | ({
      readonly kind: "launchAndBuy";
      /** What the first buy spends, in base units of the pair. */
      readonly quoteIn: bigint;
      /** The least of the new token the first buy takes. */
      readonly minimum: bigint;
      /** Who receives the first buy. */
      readonly recipient: Address;
    } & CreateBase);

const functionsOf = (abi: typeof otherRouterCreates | typeof otherFactoryCreates) =>
  abi.filter((item) => item.type === "function").map((item) => callAbiJson(item));

/**
 * The create calls, each only a launch wallet makes, as JSON ABI entries: the two this venue
 * builds, and every other create overload of the router and the factory, which it never builds.
 */
export const createFunctionsJson: {
  readonly launchToken: JsonValue;
  readonly launchAndBuy: JsonValue;
  readonly otherRouterCreates: readonly JsonValue[];
  readonly otherFactoryCreates: readonly JsonValue[];
} = {
  launchToken: callAbiJson(getAbiItem({ abi: factoryLaunchAbi, name: "launchToken" })),
  launchAndBuy: callAbiJson(getAbiItem({ abi: routerAbi, name: "launchAndBuy" })),
  otherRouterCreates: functionsOf(otherRouterCreates),
  otherFactoryCreates: functionsOf(otherFactoryCreates),
};

/** The calldata of a create call. */
export function createCallData(call: CreateCall): Hex {
  const { params, configId, pairToken, toFoundation } = call;
  if (call.kind === "launch") {
    return encodeFunctionData({
      abi: factoryLaunchAbi,
      functionName: "launchToken",
      args: [params, configId, pairToken, toFoundation],
    });
  }
  const { quoteIn, minimum, recipient } = call;
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "launchAndBuy",
    args: [params, configId, pairToken, quoteIn, minimum, recipient, toFoundation],
  });
}

/**
 * The create call a calldata holds, when it is the factory's `launchToken` or the router's
 * `launchAndBuy` with the Foundation choice; any other calldata: undefined.
 */
export function createCallOf(data: Hex): CreateCall | undefined {
  const launch = decodeCall(factoryLaunchAbi, data);
  if (launch.ok && launch.value.functionName === "launchToken") {
    const [params, configId, pairToken, toFoundation] = launch.value.args;
    return { kind: "launch", params, configId, pairToken, toFoundation };
  }
  const bought = decodeCall(routerAbi, data);
  if (!bought.ok || bought.value.functionName !== "launchAndBuy") {
    return undefined;
  }
  const [params, configId, pairToken, quoteIn, minimum, recipient, toFoundation] =
    bought.value.args;
  return {
    kind: "launchAndBuy",
    params,
    configId,
    pairToken,
    quoteIn,
    minimum,
    recipient,
    toFoundation,
  };
}

/** Whether the stack launches now, from this wallet, and what a launch pays and commits to. */
export interface LaunchTermsRead {
  /** The launch fee, in base units of the chain's coin. */
  readonly fee: bigint;
  /** Launches are open, and to this wallet. */
  readonly isOpen: boolean;
  /** The curve may trade against the pair: the chain's coin always may. */
  readonly isPair: boolean;
  /** The digest of the curve terms a launch with this configuration and pair commits to. */
  readonly economics: Hex;
}

/** A flag the factory answers about launches. */
type LaunchFlag = "launchEnabled" | "canLaunch" | "approvedPairTokens";

const flagOf =
  (functionName: LaunchFlag) =>
  (data: Hex): boolean =>
    decodeFunctionResult({ abi: factoryLaunchAbi, functionName, data });

const feeOf = (data: Hex): bigint =>
  decodeFunctionResult({ abi: factoryLaunchAbi, functionName: "launchFee", data });

const economicsOf = (data: Hex): Hex =>
  decodeFunctionResult({ abi: factoryLaunchAbi, functionName: "previewLaunchEconomics", data });

/**
 * Reads, at the latest block, the factory's launch fee, whether launches are open and whether the
 * wallet may launch, whether the pair is one a curve may trade against, and the economics digest
 * of the launch configuration and pair. A read that reverts or answers outside its shape throws.
 */
export async function readLaunchTerms(
  read: GeniusRead,
  asked: {
    readonly factory: Address;
    readonly wallet: Address;
    readonly pairToken: Address;
    readonly configId: bigint;
  },
): Promise<LaunchTermsRead> {
  const { factory, wallet, pairToken, configId } = asked;
  const view = async <T>(data: Hex, what: string, decode: (data: Hex) => T): Promise<T> =>
    readCall(read, { to: factory, data, what: `the factory's ${what}` }, decode);
  const encode = (functionName: LaunchFlag, args: readonly [Address]) =>
    encodeFunctionData({ abi: factoryLaunchAbi, functionName, args });
  const [fee, isEnabled, isAllowed, isApproved, economics] = await Promise.all([
    view(encodeFunctionData({ abi: factoryLaunchAbi, functionName: "launchFee" }), "fee", feeOf),
    view(
      encodeFunctionData({ abi: factoryLaunchAbi, functionName: "launchEnabled" }),
      "launchEnabled",
      flagOf("launchEnabled"),
    ),
    view(encode("canLaunch", [wallet]), "canLaunch", flagOf("canLaunch")),
    pairToken === zeroAddress
      ? true
      : view(encode("approvedPairTokens", [pairToken]), "pair", flagOf("approvedPairTokens")),
    view(
      encodeFunctionData({
        abi: factoryLaunchAbi,
        functionName: "previewLaunchEconomics",
        args: [configId, pairToken],
      }),
      "previewLaunchEconomics",
      economicsOf,
    ),
  ]);
  return { fee, isOpen: isEnabled && isAllowed, isPair: isApproved, economics };
}
