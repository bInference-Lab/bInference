import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type BuildRequest,
  type ChainRef,
  chainRefSchema,
  type HttpResponse,
  type QuoteRequest,
  type Venue,
  type VenueQuote,
} from "@binference/plugin-sdk";
import {
  createScriptedHttp,
  hostBuildRequest,
  type ScriptedHttp,
} from "@binference/plugin-sdk/testing";
import { createKyberswapVenue } from "../kyberswap-venue.js";
import { recordedDeadlineSec, recordedWallet } from "./recorded-terms.js";

/** BSC, the chain the answers were recorded on. */
export const bscChain: ChainRef = chainRefSchema.parse("eip155:56");

/** BNB, BSC's own coin. */
export const bnb: AssetRef = assetRefSchema.parse("eip155:56/slip44:714");

/** USDT on BSC. */
export const usdt: AssetRef = assetRefSchema.parse(
  "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955",
);

/** The venue's registry contracts on BSC, as the host gives them with a request. */
const bscContracts: Readonly<Record<string, AccountRef>> = {
  "meta-aggregation-router-v2": accountRefSchema.parse(
    "eip155:56:0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
  ),
  "aggregation-executor-proxy": accountRefSchema.parse(
    "eip155:56:0x8F10B468b06c6FD214B65F87778827F7D113f996",
  ),
};

const api = "https://aggregator-api.kyberswap.com/bsc/api/v1";

/** The routes request the venue sends for 0.1 BNB to USDT, without excluded sources. */
export const buyRoutesUrl: string = `${api}/routes?tokenIn=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&tokenOut=0x55d398326f99059fF775485246999027B3197955&amountIn=100000000000000000`;

/** The routes request the venue sends for 50 USDT to BNB. */
export const sellRoutesUrl: string = `${api}/routes?tokenIn=0x55d398326f99059fF775485246999027B3197955&tokenOut=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&amountIn=50000000000000000000`;

/** The build request the venue sends. */
export const buildUrl: string = `${api}/route/build`;

/** 0.1 BNB to USDT for the recorded wallet. */
export const buyRequest: QuoteRequest = {
  wallet: recordedWallet,
  amountIn: { asset: bnb, base: 10n ** 17n },
  assetOut: usdt,
  contracts: bscContracts,
};

/** 50 USDT to BNB for the recorded wallet. */
export const sellRequest: QuoteRequest = {
  wallet: recordedWallet,
  amountIn: { asset: usdt, base: 50n * 10n ** 18n },
  assetOut: bnb,
  contracts: bscContracts,
};

/** An answer of the API with a JSON body. */
export function answer(body: string, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

/** A scripted API: each URL with its answer, for GET routes and POST builds alike. */
export function scriptedApi(answers: Readonly<Record<string, HttpResponse>>): ScriptedHttp {
  return createScriptedHttp(
    Object.entries(answers).map(([url, response]) => ({
      method: url === buildUrl ? "POST" : "GET",
      url,
      response,
    })),
  );
}

/** The KyberSwap venue on BSC over a scripted API, with the hooks it may route through. */
export function venueOver(http: ScriptedHttp, allowedHooks: readonly string[] = []): Venue {
  return createKyberswapVenue({
    http,
    clientId: "binference",
    chains: [{ chain: bscChain, nativeAsset: bnb, allowedHooks }],
  });
}

/** What the host asks the venue to build after its quote, with the recorded deadline. */
export function buildRequestOf(
  request: QuoteRequest,
  quote: VenueQuote,
  keepBps = 9_950n,
): BuildRequest {
  return hostBuildRequest(request, quote, { deadlineMs: recordedDeadlineSec * 1000, keepBps });
}
