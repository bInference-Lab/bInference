import { assetRefSchema, chainRefSchema, type TxDraft } from "@binference/plugin-sdk";
import {
  quoterContract,
  txBuilderContract,
  txDecoderContract,
} from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import type { KyberswapChain } from "./kyberswap-options.js";
import { createKyberswapVenue } from "./kyberswap-venue.js";
import { buyBuild, buyRoute } from "./testing/recorded-buy.js";
import { noRouteAnswer } from "./testing/recorded-routes.js";
import { sellBuild, sellRoute } from "./testing/recorded-sell.js";
import { recordedDeadlineSec, recordedWallet } from "./testing/recorded-terms.js";
import {
  answer,
  bnb,
  bscChain,
  buildRequestOf,
  buildUrl,
  buyRequest,
  buyRoutesUrl,
  scriptedApi,
  sellRequest,
  sellRoutesUrl,
  usdt,
  venueOver,
} from "./testing/venue-fixtures.js";

const live = (): AbortSignal => new AbortController().signal;
const deadToken = assetRefSchema.parse(
  "eip155:56/erc20:0x000000000000000000000000000000000000dEaD",
);
const deadRoutesUrl = buyRoutesUrl.replace(
  "0x55d398326f99059fF775485246999027B3197955",
  "0x000000000000000000000000000000000000dEaD",
);

const recorded = scriptedApi({
  [buyRoutesUrl]: answer(buyRoute),
  [sellRoutesUrl]: answer(sellRoute),
  [deadRoutesUrl]: answer(noRouteAnswer, 400),
});
const buyQuote = await venueOver(recorded).quote(buyRequest, { signal: live() });
const sellQuote = await venueOver(recorded).quote(sellRequest, { signal: live() });
if (!buyQuote.ok || !sellQuote.ok) {
  throw new Error("The recorded routes gave no quote.");
}
const buyBuildRequest = buildRequestOf(buyRequest, buyQuote.value);
const sellBuildRequest = buildRequestOf(sellRequest, sellQuote.value);
const [trade] = await venueOver(scriptedApi({ [buildUrl]: answer(buyBuild) })).build(
  buyBuildRequest,
  { signal: live() },
);
const [approval] = await venueOver(scriptedApi({ [buildUrl]: answer(sellBuild) })).build(
  sellBuildRequest,
  { signal: live() },
);

function draftOf(draft: TxDraft | undefined): TxDraft {
  if (draft === undefined) {
    throw new Error("The recorded build gave no draft.");
  }
  return draft;
}

function chainWith(change: Partial<KyberswapChain>): KyberswapChain {
  return { chain: bscChain, nativeAsset: bnb, allowedHooks: [], ...change };
}

describe("the kyberswap venue", () => {
  it.each([
    ...quoterContract({
      create: () => ({
        quoter: venueOver(recorded),
        request: buyRequest,
        unroutable: { ...buyRequest, assetOut: deadToken },
      }),
    }),
    ...txBuilderContract({
      create: () => ({
        builder: venueOver(scriptedApi({ [buildUrl]: answer(sellBuild) })),
        request: sellBuildRequest,
      }),
    }),
    ...txDecoderContract({
      create: () => ({
        decoder: venueOver(scriptedApi({})),
        draft: draftOf(trade),
        effect: {
          recipient: recordedWallet,
          amountIn: { asset: bnb, base: 10n ** 17n },
          minOut: buyBuildRequest.minOut,
          deadlineMs: recordedDeadlineSec * 1000,
        },
        foreign: draftOf(approval),
      }),
    }),
  ])("follows the venue contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("declares KyberSwap's router and executor proxy on each chain it trades on", () => {
    const venue = venueOver(scriptedApi({}));
    expect(venue.id).toBe("kyberswap");
    expect(venue.contracts).toStrictEqual([
      { chain: bscChain, names: ["meta-aggregation-router-v2", "aggregation-executor-proxy"] },
    ]);
  });

  it("names itself to KyberSwap with its client id on every call", async () => {
    const http = scriptedApi({ [buyRoutesUrl]: answer(buyRoute) });
    await venueOver(http).quote(buyRequest, { signal: live() });
    expect(http.requests().map((request) => request.headers)).toStrictEqual([
      { "x-client-id": "binference" },
    ]);
  });

  it.each<[string, Partial<KyberswapChain>]>([
    ["a chain KyberSwap's API has no name for here", { chain: chainRefSchema.parse("eip155:1") }],
    ["the coin of another chain", { nativeAsset: assetRefSchema.parse("eip155:1/slip44:60") }],
    ["a token as the native asset", { nativeAsset: usdt }],
    ["a hook that is no EVM address", { allowedHooks: ["0x44428c6c"] }],
  ])("refuses to trade on %s", (_case, change) => {
    const options = { http: scriptedApi({}), clientId: "binference", chains: [chainWith(change)] };
    expect(() => createKyberswapVenue(options)).toThrow(
      expect.objectContaining({ code: "kyberswap.bad_options" }),
    );
  });

  it.each<[string, readonly KyberswapChain[], string]>([
    ["no chain", [], "binference"],
    ["one chain twice", [chainWith({}), chainWith({})], "binference"],
    ["a client id no header carries", [chainWith({})], "bin ference\n"],
  ])("refuses options with %s", (_case, chains, clientId) => {
    expect(() => createKyberswapVenue({ http: scriptedApi({}), clientId, chains })).toThrow(
      expect.objectContaining({ code: "kyberswap.bad_options" }),
    );
  });
});
