import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  BinferenceError,
  type BridgeQuoteRequest,
  chainRefSchema,
  type ChainRef,
  type HttpResponse,
} from "@binference/plugin-sdk";
import {
  createScriptedHttp,
  type ScriptedHttp,
  type ScriptedRoute,
} from "@binference/plugin-sdk/testing";
import type { Hex } from "viem";
import type { AcrossOptions, AcrossRoute } from "../across-options.js";
import { depositUrlOf, swapUrlOf } from "../api/across-api.js";
import { routeQueryOf } from "../routes/route-query.js";
import { expiredAnswer, filledAnswer, notFoundAnswer, refundedAnswer } from "./recorded-answers.js";
import {
  ethToBaseAnswer,
  ethToRobinhoodAnswer,
  usdcToBaseAnswer,
  usdcToEthereumAnswer,
  usdtToArbitrumAnswer,
} from "./recorded-quotes.js";

/** BNB Smart Chain, where Across's deposits leave from. */
export const bsc: ChainRef = chainRefSchema.parse("eip155:56");
/** Base, a destination chain. */
export const base: ChainRef = chainRefSchema.parse("eip155:8453");

const token = (text: string): AssetRef => assetRefSchema.parse(text);

type TokenName =
  | "usdc"
  | "usdt"
  | "eth"
  | "ethereumUsdc"
  | "baseUsdc"
  | "baseWeth"
  | "arbitrumUsdt0"
  | "robinhoodWeth"
  | "robinhoodUsdg"
  | "solanaUsdc";

/** The tokens of the recorded routes, each as the registry lists it on its chain. */
export const tokens: Readonly<Record<TokenName, AssetRef>> = {
  usdc: token("eip155:56/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"),
  usdt: token("eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955"),
  eth: token("eip155:56/erc20:0x2170Ed0880ac9A755fd29B2688956BD959F933F8"),
  ethereumUsdc: token("eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  baseUsdc: token("eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  baseWeth: token("eip155:8453/erc20:0x4200000000000000000000000000000000000006"),
  arbitrumUsdt0: token("eip155:42161/erc20:0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"),
  robinhoodWeth: token("eip155:4663/erc20:0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
  robinhoodUsdg: token("eip155:4663/erc20:0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
  solanaUsdc: token(
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  ),
} as const;

/** The routes the recorded answers quote, a part of the registry's Across routes. */
export const recordedRoutes: readonly AcrossRoute[] = [
  { leaves: tokens.usdc, arrives: tokens.baseUsdc, decimals: { leaves: 18, arrives: 6 } },
  { leaves: tokens.usdc, arrives: tokens.ethereumUsdc, decimals: { leaves: 18, arrives: 6 } },
  { leaves: tokens.usdt, arrives: tokens.arbitrumUsdt0, decimals: { leaves: 18, arrives: 6 } },
  {
    leaves: tokens.eth,
    arrives: tokens.baseWeth,
    decimals: { leaves: 18, arrives: 18 },
    coin: token("eip155:8453/slip44:60"),
  },
  {
    leaves: tokens.eth,
    arrives: tokens.robinhoodWeth,
    decimals: { leaves: 18, arrives: 18 },
    coin: token("eip155:4663/slip44:60"),
  },
];

/** Across's SpokePool on BSC and on each destination, from its deployed addresses. */
export const spokePools: AcrossOptions["spokePools"] = {
  [bsc]: accountRefSchema.parse("eip155:56:0x4e8E101924eDE233C13e2D8622DC8aED2872d505"),
  [chainRefSchema.parse("eip155:1")]: accountRefSchema.parse(
    "eip155:1:0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
  ),
  [chainRefSchema.parse("eip155:8453")]: accountRefSchema.parse(
    "eip155:8453:0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
  ),
  [chainRefSchema.parse("eip155:42161")]: accountRefSchema.parse(
    "eip155:42161:0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
  ),
  [chainRefSchema.parse("eip155:4663")]: accountRefSchema.parse(
    "eip155:4663:0xD29C85F15DF544bA632C9E25829fd29d767d7978",
  ),
};

/** Across's SpokePool on BNB Smart Chain, as the registry lists it. */
export const spokePool: AccountRef = accountRefSchema.parse(
  "eip155:56:0x4e8E101924eDE233C13e2D8622DC8aED2872d505",
);

/** The depositor of every recorded quote. */
export const wallet: AccountRef = accountRefSchema.parse(
  "eip155:56:0x1111111111111111111111111111111111111111",
);

/** The recipient on a chain, the address every recorded quote paid. */
export function recipientOn(chain: ChainRef): AccountRef {
  return accountRefSchema.parse(`${chain}:0x2222222222222222222222222222222222222222`);
}

const tokensWei = 10n ** 18n;

/** A request for one of the recorded routes: 20 dollars, or 0.01 ETH. */
export function requestFor(leaves: AssetRef, arrives: AssetRef): BridgeQuoteRequest {
  const isEth = leaves === tokens.eth;
  const destination = assetRefParts(arrives).chain;
  return {
    wallet,
    amountIn: { asset: leaves, base: isEth ? tokensWei / 100n : 20n * tokensWei },
    recipient: recipientOn(destination),
    deliveredAsset: arrives,
    cappedAssets: [tokens.usdc, tokens.usdt, tokens.eth],
    contracts: { "spoke-pool": spokePool },
  };
}

/** The recorded Base fill: the BSC deposit, and its fill on Base. */
export const recordedFill = {
  deposit: "0x84e24fa961f7b9c2d40b5e9a18fe34888a9541e857797192bfc0f2611be469bb",
  fill: "0xd7a696a19dbed9d281fef7ba747b4d00ac86ae62e83840b050cfd987f9073fa2",
} as const;
/** The recorded deposit to Ethereum that Across refunded, and the refund on BSC. */
export const recordedRefund = {
  deposit: "0x425a890b4c454be3ac17498847feacdeae3519144039112dea645070eac48838",
  refund: "0x815c159eafd5cca6e5792aa61c576c8e4eb870f16e4a52d41cc2a3d7c6ef0d8b",
} as const;
/** The recorded deposit to Robinhood Chain past its fill deadline. */
export const recordedExpired = "0xffacfcc48391c408c021fc5c715842320b691c3ba59497a41826d951bdde4c1c";
/** A deposit Across never saw. */
export const unseenDeposit: Hex = `0x${"11".repeat(32)}`;

const json = (status: number, body: string): HttpResponse => ({ status, headers: {}, body });

function quoteRoute(arrives: AssetRef, leaves: AssetRef, body: string): ScriptedRoute {
  const options = {
    http: createScriptedHttp([]),
    chains: [bsc],
    routes: recordedRoutes,
    spokePools,
  };
  const query = routeQueryOf(requestFor(leaves, arrives), options)?.query;
  if (query === undefined) {
    throw new BinferenceError({
      code: "across.bad_fixture",
      message: "A recorded route is not one the bridge takes.",
    });
  }
  return { method: "GET", url: swapUrlOf(query), response: json(200, body) };
}

/** Across's API as it answered on 2026-11-01, for the recorded routes and deposits. */
export function recordedApi(extra: readonly ScriptedRoute[] = []): ScriptedHttp {
  return createScriptedHttp([
    ...extra,
    quoteRoute(tokens.baseUsdc, tokens.usdc, usdcToBaseAnswer),
    quoteRoute(tokens.ethereumUsdc, tokens.usdc, usdcToEthereumAnswer),
    quoteRoute(tokens.arbitrumUsdt0, tokens.usdt, usdtToArbitrumAnswer),
    quoteRoute(tokens.baseWeth, tokens.eth, ethToBaseAnswer),
    quoteRoute(tokens.robinhoodWeth, tokens.eth, ethToRobinhoodAnswer),
    { method: "GET", url: depositUrlOf(recordedFill.deposit), response: json(200, filledAnswer) },
    {
      method: "GET",
      url: depositUrlOf(recordedRefund.deposit),
      response: json(200, refundedAnswer),
    },
    { method: "GET", url: depositUrlOf(recordedExpired), response: json(200, expiredAnswer) },
    { method: "GET", url: depositUrlOf(unseenDeposit), response: json(404, notFoundAnswer) },
  ]);
}

/** What the Across bridge is made from over {@link recordedApi}: BNB Smart Chain and the recorded routes. */
export function recordedOptions(http: ScriptedHttp = recordedApi()): AcrossOptions {
  return { http, chains: [bsc], routes: recordedRoutes, spokePools };
}
