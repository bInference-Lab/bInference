import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  BinferenceError,
  type BridgeQuoteRequest,
  type ChainRef,
  chainRefSchema,
  type Http,
  type HttpRequest,
  type HttpResponse,
} from "@binference/plugin-sdk";
import {
  createManualClock,
  createScriptedHttp,
  type ScriptedRoute,
} from "@binference/plugin-sdk/testing";
import type { Hex } from "viem";
import { z } from "zod";
import { quoteUrl, requestsUrlOf } from "../api/relay-api.js";
import { relaySolver } from "../relay-chains.js";
import type { RelayOptions, RelayRoute } from "../relay-options.js";
import tooLow from "./recorded/error-amount-too-low.json" with { type: "json" };
import noLiquidity from "./recorded/error-insufficient-liquidity.json" with { type: "json" };
import usdcToBase from "./recorded/quote-usdc-base.json" with { type: "json" };
import usdcToRobinhood from "./recorded/quote-usdc-robinhood.json" with { type: "json" };
import usdcToSolana from "./recorded/quote-usdc-solana.json" with { type: "json" };
import usdtToRobinhood from "./recorded/quote-usdt-robinhood.json" with { type: "json" };
import fillBase from "./recorded/request-fill-base.json" with { type: "json" };
import fillSolana from "./recorded/request-fill-solana.json" with { type: "json" };
import refund from "./recorded/request-refund.json" with { type: "json" };
import unseen from "./recorded/request-unseen.json" with { type: "json" };

/** BNB Smart Chain, where Relay's deposits leave from. */
export const bsc: ChainRef = chainRefSchema.parse("eip155:56");
/** Base, an EVM destination. */
export const base: ChainRef = chainRefSchema.parse("eip155:8453");
/** Solana mainnet, a destination of another family. */
export const solana: ChainRef = chainRefSchema.parse("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");

const token = (text: string): AssetRef => assetRefSchema.parse(text);

type TokenName = "usdc" | "usdt" | "baseUsdc" | "robinhoodUsdg" | "solanaUsdc";

/** The tokens of the recorded routes, each as the registry lists it on its chain. */
export const tokens: Readonly<Record<TokenName, AssetRef>> = {
  usdc: token("eip155:56/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"),
  usdt: token("eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955"),
  baseUsdc: token("eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  robinhoodUsdg: token("eip155:4663/erc20:0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"),
  solanaUsdc: token(`${solana}/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`),
};

const dollars = { leaves: 18, arrives: 6 };

/** The routes the recorded answers quote, a part of the registry's Relay routes, with its swap caps. */
export const recordedRoutes: readonly RelayRoute[] = [
  { leaves: tokens.usdc, arrives: tokens.baseUsdc, decimals: dollars },
  { leaves: tokens.usdc, arrives: tokens.solanaUsdc, decimals: dollars },
  { leaves: tokens.usdt, arrives: tokens.robinhoodUsdg, decimals: dollars, swapCapBps: 50 },
  { leaves: tokens.usdc, arrives: tokens.robinhoodUsdg, decimals: dollars, swapCapBps: 50 },
];

/** Relay's depository on BSC, as the registry lists it. */
export const depository: AccountRef = accountRefSchema.parse(
  "eip155:56:0x4cD00E387622C35bDDB9b4c962C136462338BC31",
);

/** The depositor of every recorded quote. */
export const wallet: AccountRef = accountRefSchema.parse(
  "eip155:56:0x1111111111111111111111111111111111111111",
);

/** The base58 recipient the recorded Solana quote paid. */
export const solanaPerson = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

/** The recipient on a chain the recorded quotes paid: `0x2222…` on an EVM chain. */
export function recipientOn(chain: ChainRef): AccountRef {
  const address = chain === solana ? solanaPerson : `0x${"22".repeat(20)}`;
  return accountRefSchema.parse(`${chain}:${address}`);
}

/** A request for one of the recorded routes: 20 dollars to the recipient the quote paid. */
export function requestFor(leaves: AssetRef, arrives: AssetRef): BridgeQuoteRequest {
  return {
    wallet,
    amountIn: { asset: leaves, base: 20n * 10n ** 18n },
    recipient: recipientOn(assetRefParts(arrives).chain),
    deliveredAsset: arrives,
    cappedAssets: [tokens.usdc, tokens.usdt],
    contracts: { depository },
  };
}

/** When the recorded quotes were given, as the clock of {@link recordedOptions} reads. */
export const recordedAtMs = 1_793_546_954_000;

/** The deposits whose requests Relay's requests endpoint answered on 2026-11-01. */
export const recordedDeposits: Readonly<
  Record<"fillBase" | "fillSolana" | "refund" | "unseen" | "expired", Hex>
> = {
  fillBase: "0x1bf6374e215d2c42b383149994fdc749435db9f7b5fdcf25c1cea0ef873a04ca",
  fillSolana: "0x52f0b7f6ac2c0bf26a8bc90c581bee700fa376b607f43b7792055456618c51e4",
  refund: "0x001825aedff8d399a15eaab5ab09716ac203b990a261e5358e18ceb8ae291d06",
  unseen: `0x${"11".repeat(32)}`,
  expired: `0x${"22".repeat(32)}`,
};

const answer = (status: number, body: object): HttpResponse => ({
  status,
  headers: {},
  body: JSON.stringify(body),
});

const askedSchema = z.looseObject({
  destinationChainId: z.number(),
  destinationCurrency: z.string(),
  originCurrency: z.string(),
  amount: z.string(),
});

// The recorded quote for a request's body: its destination, its tokens and its amount.
const keyOf = (id: number, arrives: AssetRef, leaves: string): string =>
  `${String(id)} ${assetRefParts(arrives).assetReference.toLowerCase()} ${leaves}`;
const recordedQuotes: ReadonlyMap<string, HttpResponse> = new Map([
  [keyOf(8453, tokens.baseUsdc, "usdc"), answer(200, usdcToBase)],
  [keyOf(792_703_809, tokens.solanaUsdc, "usdc"), answer(200, usdcToSolana)],
  [keyOf(4663, tokens.robinhoodUsdg, "usdt"), answer(200, usdtToRobinhood)],
  [keyOf(4663, tokens.robinhoodUsdg, "usdc"), answer(200, usdcToRobinhood)],
]);

const symbolOf: Readonly<Record<string, string>> = {
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "usdc",
  "0x55d398326f99059ff775485246999027b3197955": "usdt",
};

function quoteAnswer(request: HttpRequest): HttpResponse | undefined {
  const asked = askedSchema.safeParse(JSON.parse(request.body ?? "null"));
  if (!asked.success) {
    return undefined;
  }
  const { destinationChainId, destinationCurrency, originCurrency, amount } = asked.data;
  if (amount === "1000") {
    return answer(400, tooLow);
  }
  if (amount.length > 24) {
    return answer(400, noLiquidity);
  }
  const symbol = symbolOf[originCurrency.toLowerCase()] ?? "none";
  const key = `${String(destinationChainId)} ${destinationCurrency.toLowerCase()} ${symbol}`;
  return recordedQuotes.get(key) ?? answer(400, { errorCode: "UNSUPPORTED_ROUTE" });
}

// The recorded refund edited into a failed fill no refund follows, for a deposit of its own: Relay
// gave no such answer on the day it was recorded.
function expiredAnswer(): HttpResponse {
  const body = JSON.stringify(refund)
    .replaceAll(recordedDeposits.refund, recordedDeposits.expired)
    .replace('"status":"refund"', '"status":"failure"')
    .replace('"refundFailReason":"N/A"', '"refundFailReason":"AMOUNT_TOO_LOW_TO_REFUND"');
  return { status: 200, headers: {}, body };
}

const requestRoute = (hash: Hex, response: HttpResponse): ScriptedRoute => ({
  method: "GET",
  url: requestsUrlOf(hash, { keyed: false }),
  response,
});

const requestRoutes: readonly ScriptedRoute[] = [
  requestRoute(recordedDeposits.expired, expiredAnswer()),
  requestRoute(recordedDeposits.fillBase, answer(200, fillBase)),
  requestRoute(recordedDeposits.fillSolana, answer(200, fillSolana)),
  requestRoute(recordedDeposits.refund, answer(200, refund)),
  requestRoute(recordedDeposits.unseen, answer(200, unseen)),
];

/** An `Http` over Relay's recorded answers that keeps every request it got. */
export interface RecordedApi extends Http {
  requests(): readonly HttpRequest[];
}

/**
 * Relay's API as it answered on 2026-11-01: the recorded quotes by their destination, tokens and
 * amount (1,000 base units too low, more than 24 digits over its liquidity), and the recorded
 * requests by their deposit, after the extra routes given. Anything else is unreachable.
 */
export function recordedApi(extra: readonly ScriptedRoute[] = []): RecordedApi {
  const scripted = createScriptedHttp([...extra, ...requestRoutes]);
  const quotes: HttpRequest[] = [];
  return {
    async request(request) {
      if (request.method !== "POST" || request.url !== quoteUrl) {
        return scripted.request(request);
      }
      request.signal.throwIfAborted();
      quotes.push(request);
      const found = quoteAnswer(request);
      if (found === undefined) {
        throw new BinferenceError({
          code: "http.unreachable",
          message: "Not recorded.",
          retryable: true,
        });
      }
      return Promise.resolve(found);
    },
    requests: () => [...quotes, ...scripted.requests()],
  };
}

/** What the Relay bridge is made from over {@link recordedApi}, at the recorded quotes' time. */
export function recordedOptions(http: Http = recordedApi()): RelayOptions {
  return {
    http,
    clock: createManualClock(recordedAtMs),
    chains: [bsc],
    routes: recordedRoutes,
    depositories: { [bsc]: depository },
    solver: relaySolver,
  };
}
