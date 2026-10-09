import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type BuildRequest,
  chainRefSchema,
  type Clock,
  createSecret,
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
import type { Address } from "viem";
import type { OkxKeys } from "../okx-options.js";
import { createOkxVenue } from "../okx-venue.js";

/** BNB, BSC's own coin. */
export const bnb: AssetRef = assetRefSchema.parse("eip155:56/slip44:714");

/** USDT on BSC. */
export const usdt: AssetRef = assetRefSchema.parse(
  "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955",
);

/** The wallet the fixtures trade from. */
export const walletAddress: Address = "0x4B0897b0513fdC7C541B6d9D7E929C4e5364D2dB";

/** {@link walletAddress} on BSC. */
export const wallet: AccountRef = accountRefSchema.parse(`eip155:56:${walletAddress}`);

/** OKX's DEX router on BSC, as the registry lists it. */
export const okxRouter: Address = "0x5994814f2C4040b863A0125A45DE152a8c2A4DEc";

/** OKX's TokenApprove on BSC, as the registry lists it. */
export const okxApprover: Address = "0x2c34A2Fb1d0b4f55de51E1d0bDEfaDDce6b7cDD6";

// The venue's registry contracts on BSC, as the host gives them with a request.
const okxContracts: Readonly<Record<string, AccountRef>> = {
  "dex-router": accountRefSchema.parse(`eip155:56:${okxRouter}`),
  "token-approve": accountRefSchema.parse(`eip155:56:${okxApprover}`),
};

/** A test key; none of it is a real credential. */
export const testKeys: OkxKeys = {
  apiKey: createSecret("test-api-key"),
  secretKey: createSecret("test-secret-key"),
  passphrase: createSecret("test-passphrase"),
};

/** When the fixtures quote: 2026-10-08 18:13:20 UTC. */
export const quotedAtMs = 1_791_483_200_000;

/** A clock stopped at {@link quotedAtMs}. */
export const fixedClock: Clock = {
  now: () => quotedAtMs,
  sleep: async (_delayMs, signal) => {
    signal.throwIfAborted();
    return Promise.resolve();
  },
};

/** 0.1 BNB to USDT. */
export const buyRequest: QuoteRequest = {
  wallet,
  amountIn: { asset: bnb, base: 10n ** 17n },
  assetOut: usdt,
  contracts: okxContracts,
};

/** 50 USDT to BNB. */
export const sellRequest: QuoteRequest = {
  wallet,
  amountIn: { asset: usdt, base: 50n * 10n ** 18n },
  assetOut: bnb,
  contracts: okxContracts,
};

const api = "https://web3.okx.com/api/v6/dex/aggregator";

/** The URL of a call to OKX's aggregator API with its query, in the order the client writes it. */
export function okxUrl(path: string, query: Readonly<Record<string, string>>): string {
  return `${api}${path}?${new URLSearchParams(query).toString()}`;
}

/** An answer of the API with a JSON body. */
export function answer(body: object, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** A scripted API for GET requests: each URL with its answer. */
export function scriptedApi(answers: Readonly<Record<string, HttpResponse>>): ScriptedHttp {
  return createScriptedHttp(
    Object.entries(answers).map(([url, response]) => ({ method: "GET", url, response })),
  );
}

/** The OKX venue on BSC over a scripted API, with the test key and the stopped clock. */
export function venueOver(http: ScriptedHttp): Venue {
  return createOkxVenue({
    http,
    clock: fixedClock,
    keys: testKeys,
    chains: [{ chain: chainRefSchema.parse("eip155:56"), nativeAsset: bnb }],
  });
}

/** What the host asks the venue to build after its quote: 60 s from {@link quotedAtMs}. */
export function buildRequestOf(request: QuoteRequest, quote: VenueQuote): BuildRequest {
  return hostBuildRequest(request, quote, { deadlineMs: quotedAtMs + 60_000 });
}
