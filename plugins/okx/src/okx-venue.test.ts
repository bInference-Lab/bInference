import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  createSecret,
  type TxDraft,
} from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import {
  draftAt,
  quoterContract,
  successOf,
  txBuilderContract,
  txDecoderContract,
} from "@binference/plugin-sdk/testing";
import { encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import type { OkxChain, OkxKeys } from "./okx-options.js";
import { createOkxVenue } from "./okx-venue.js";
import { errorAnswer, liquidityAnswer, quoteAnswer, swapAnswer } from "./testing/okx-answers.js";
import {
  buyQuoteAnswer,
  buyRoute,
  buySwapAnswer,
  quoteUrlOf,
  sellQuoteAnswer,
  sellRoute,
  sellSwapAnswer,
  swapUrlOf,
} from "./testing/okx-trades.js";
import {
  bnb,
  buildRequestOf,
  buyRequest,
  fixedClock,
  okxApprover,
  okxRouter,
  okxUrl,
  quotedAtMs,
  scriptedApi,
  sellRequest,
  testKeys,
  usdt,
  venueOver,
  wallet,
  walletAddress,
} from "./testing/venue-fixtures.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const bsc = chainRefSchema.parse("eip155:56");
const deadToken = assetRefSchema.parse(
  "eip155:56/erc20:0x000000000000000000000000000000000000dEaD",
);
const deadUrl = quoteUrlOf({ ...buyRoute, tokenOut: "0x000000000000000000000000000000000000dEaD" });
const recorded = scriptedApi({
  [quoteUrlOf(buyRoute)]: buyQuoteAnswer,
  [quoteUrlOf(sellRoute)]: sellQuoteAnswer,
  [deadUrl]: errorAnswer("82000"),
  [swapUrlOf(buyRoute)]: buySwapAnswer,
  [swapUrlOf(sellRoute)]: sellSwapAnswer,
});
const buyQuote = successOf(await venueOver(recorded).quote(buyRequest, live()));
const sellQuote = successOf(await venueOver(recorded).quote(sellRequest, live()));
const buyTerms = buildRequestOf(buyRequest, buyQuote);
const sellTerms = buildRequestOf(sellRequest, sellQuote);
const buyDrafts = await venueOver(recorded).build(buyTerms, live());
const sellDrafts = await venueOver(recorded).build(sellTerms, live());

function callOf(draft: TxDraft) {
  return successOf(decodeEvmDraft(draft));
}

function chainWith(change: Partial<OkxChain>): OkxChain {
  return { chain: bsc, nativeAsset: bnb, ...change };
}

describe("the okx venue", () => {
  it.each([
    ...quoterContract({
      create: () => ({
        quoter: venueOver(recorded),
        request: buyRequest,
        unroutable: { ...buyRequest, assetOut: deadToken },
      }),
    }),
    ...txBuilderContract({
      create: () => ({ builder: venueOver(recorded), request: sellTerms }),
    }),
    ...txDecoderContract({
      create: () => ({
        decoder: venueOver(scriptedApi({})),
        draft: draftAt(buyDrafts, 0),
        effect: {
          recipient: wallet,
          amountIn: { asset: bnb, base: 10n ** 17n },
          minOut: buyTerms.minOut,
          deadlineMs: quotedAtMs + 60_000,
        },
        foreign: draftAt(sellDrafts, 0),
      }),
    }),
  ])("follows the venue contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("declares OKX's DEX router and TokenApprove on each chain it trades on", () => {
    const venue = venueOver(scriptedApi({}));
    expect(venue.id).toBe("okx");
    expect(venue.contracts).toStrictEqual([{ chain: bsc, names: ["dex-router", "token-approve"] }]);
  });

  it("quotes OKX's expected output and its price impact, rounded up", () => {
    expect(buyQuote).toMatchObject({
      expectedOut: { asset: usdt, base: 74_200_000_000_000_000_000n },
      priceImpactBps: 5,
    });
  });

  it("buys with one call to the registry's router, at the host's minimum and deadline", () => {
    expect(buyDrafts).toHaveLength(1);
    const trade = callOf(draftAt(buyDrafts, 0));
    expect(trade).toMatchObject({ from: walletAddress, to: okxRouter, value: 10n ** 17n });
    const decoded = successOf(venueOver(scriptedApi({})).decode(draftAt(buyDrafts, 0)));
    expect(decoded.minOut.base).toBe(buyTerms.minOut.base);
    expect(decoded.deadlineMs).toBe(quotedAtMs + 60_000);
  });

  it("sells after an exact approval of OKX's TokenApprove, keeping OKX's higher minimum", () => {
    expect(sellDrafts.map(callOf)).toStrictEqual([
      {
        from: walletAddress,
        to: "0x55d398326f99059fF775485246999027B3197955",
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [okxApprover, 50n * 10n ** 18n],
        }),
      },
      expect.objectContaining({ to: okxRouter, value: 0n }),
    ]);
    const decoded = successOf(venueOver(scriptedApi({})).decode(draftAt(sellDrafts, 1)));
    expect(decoded).toMatchObject({
      recipient: wallet,
      amountIn: { asset: usdt, base: 50n * 10n ** 18n },
      minOut: { asset: bnb, base: 66_963_500_000_000_000n },
    });
  });

  it("asks once more without the protocols whose hooks it cannot check, by their DEX ids", async () => {
    const hooked = { ...buyRoute, sources: ["PancakeSwap Infinity CL", "PancakeSwap V3"] };
    const http = scriptedApi({
      [quoteUrlOf(buyRoute)]: quoteAnswer(hooked),
      [okxUrl("/get-liquidity", { chainIndex: "56" })]: liquidityAnswer([
        ["1", "PancakeSwap V3"],
        ["190", "PancakeSwap Infinity CL"],
        ["191", "Uniswap V4"],
      ]),
      [quoteUrlOf(buyRoute, "190,191")]: buyQuoteAnswer,
      [swapUrlOf(buyRoute, "190,191")]: buySwapAnswer,
    });
    const quote = successOf(await venueOver(http).quote(buyRequest, live()));
    await venueOver(http).build(buildRequestOf(buyRequest, quote), live());
    expect(http.requests().map((request) => new URL(request.url).pathname)).toStrictEqual([
      "/api/v6/dex/aggregator/quote",
      "/api/v6/dex/aggregator/get-liquidity",
      "/api/v6/dex/aggregator/quote",
      "/api/v6/dex/aggregator/swap",
    ]);
  });

  it.each([
    ["a second route through hooks", [["190", "PancakeSwap Infinity CL"]], "Uniswap V4"],
    ["no DEX id to exclude", [["1", "PancakeSwap V3"]], "PancakeSwap V3"],
  ] as const)("gives no route on %s", async (_label, sources, secondSource) => {
    const hooked = { ...buyRoute, sources: ["PancakeSwap Infinity CL"] };
    const http = scriptedApi({
      [quoteUrlOf(buyRoute)]: quoteAnswer(hooked),
      [okxUrl("/get-liquidity", { chainIndex: "56" })]: liquidityAnswer(sources),
      [quoteUrlOf(buyRoute, "190")]: quoteAnswer({ ...buyRoute, sources: [secondSource] }),
    });
    await expect(venueOver(http).quote(buyRequest, live())).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it("gives no route for an asset of another chain, without asking OKX", async () => {
    const http = scriptedApi({});
    const request = { ...buyRequest, assetOut: assetRefSchema.parse("eip155:1/slip44:60") };
    await expect(venueOver(http).quote(request, live())).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
    expect(http.requests()).toHaveLength(0);
  });

  it("throws on a quote for another amount", async () => {
    const http = scriptedApi({
      [quoteUrlOf(buyRoute)]: quoteAnswer({ ...buyRoute, amountIn: 10n ** 16n }),
    });
    await expect(venueOver(http).quote(buyRequest, live())).rejects.toMatchObject({
      code: "okx.bad_route",
    });
  });

  it.each([
    {
      label: "another router",
      to: "0x3156020dfF8D99af1dDC523ebDfb1ad2018554a0",
      from: walletAddress,
      source: "PancakeSwap V3",
    },
    {
      label: "another wallet's call",
      to: okxRouter,
      from: "0x26A8dE6E177eF67bbaD4D4a8A26E9178D7fC6DEb",
      source: "PancakeSwap V3",
    },
    { label: "a route through hooks", to: okxRouter, from: walletAddress, source: "Uniswap V4" },
  ] as const)("refuses to build $label", async ({ to, from, source }) => {
    const data = callOf(draftAt(buyDrafts, 0)).data;
    const tx = { from, to, value: 10n ** 17n, data, minReceiveAmount: 1n };
    const answer = swapAnswer({ ...buyRoute, sources: [source] }, tx);
    const http = scriptedApi({ [swapUrlOf(buyRoute)]: answer });
    await expect(venueOver(http).build(buyTerms, live())).rejects.toMatchObject({
      code: "okx.bad_build",
    });
  });

  it.each([
    ["OKX finds no route any more", { quote: buyQuote, answer: errorAnswer("82000") }],
    [
      "the quote carries no OKX route",
      { quote: { ...buyQuote, route: "{}" }, answer: buySwapAnswer },
    ],
  ])("throws okx no route when %s", async (_label, { quote, answer }) => {
    const http = scriptedApi({ [swapUrlOf(buyRoute)]: answer });
    await expect(venueOver(http).build({ ...buyTerms, quote }, live())).rejects.toMatchObject({
      code: "okx.no_route",
    });
  });

  it.each<[string, Partial<OkxChain>]>([
    ["a chain OKX's API has no index for here", { chain: chainRefSchema.parse("eip155:1") }],
    ["the coin of another chain", { nativeAsset: assetRefSchema.parse("eip155:1/slip44:60") }],
    ["a token as the native asset", { nativeAsset: usdt }],
  ])("refuses to trade on %s", (_case, change) => {
    const options = { http: scriptedApi({}), clock: fixedClock, keys: testKeys };
    expect(() => createOkxVenue({ ...options, chains: [chainWith(change)] })).toThrow(
      expect.objectContaining({ code: "okx.bad_options" }),
    );
  });

  it.each<[string, readonly OkxChain[], OkxKeys]>([
    ["no chain", [], testKeys],
    ["one chain twice", [chainWith({}), chainWith({})], testKeys],
    ["an empty key", [chainWith({})], { ...testKeys, apiKey: createSecret("") }],
    ["a blank secret", [chainWith({})], { ...testKeys, secretKey: createSecret("  ") }],
    ["no passphrase", [chainWith({})], { ...testKeys, passphrase: createSecret("") }],
  ])("refuses options with %s", (_case, chains, keys) => {
    expect(() =>
      createOkxVenue({ http: scriptedApi({}), clock: fixedClock, keys, chains }),
    ).toThrow(expect.objectContaining({ code: "okx.bad_options" }));
  });

  it("decodes no draft on a chain it does not trade on", () => {
    const draft = { ...draftAt(buyDrafts, 0), chain: chainRefSchema.parse("eip155:1") };
    const foreign = { ...draft, from: accountRefSchema.parse(`eip155:1:${walletAddress}`) };
    expect(venueOver(scriptedApi({})).decode(foreign)).toStrictEqual({
      ok: false,
      error: "unknown_call",
    });
  });
});
