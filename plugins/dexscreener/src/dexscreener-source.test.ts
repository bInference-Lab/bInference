import { assetRefSchema, chainRefSchema, type HttpResponse } from "@binference/plugin-sdk";
import {
  createManualClock,
  createScriptedHttp,
  marketDataSourceContract,
  type ScriptedRoute,
} from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createDexscreenerSource } from "./dexscreener-source.js";
import {
  boostedAddresses,
  boostedTokensAnswer,
  noPairsAnswer,
  topBoostsAnswer,
  wbnbAddress,
  wbnbPairsAnswer,
} from "./testing/recorded-answers.js";

const origin = "https://api.dexscreener.com";
const bsc = chainRefSchema.parse("eip155:56");
const unknownAddress = "0x000000000000000000000000000000000000dEaD";
const tokenOf = (address: string) => assetRefSchema.parse(`eip155:56/erc20:${address}`);
const wbnb = tokenOf(wbnbAddress);
const usdt = tokenOf("0x55d398326f99059fF775485246999027B3197955");
const usdc = tokenOf("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
const [firstBoosted, secondBoosted] = boostedAddresses;
const pairsUrl = (address: string): string => `${origin}/token-pairs/v1/bsc/${address}`;
const boostsUrl = `${origin}/token-boosts/top/v1`;
const boostedUrl = `${origin}/tokens/v1/bsc/${boostedAddresses.join(",")}`;
const live = { signal: new AbortController().signal };

function answer(body: string, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

const recorded: readonly ScriptedRoute[] = [
  { method: "GET", url: pairsUrl(wbnbAddress), response: answer(wbnbPairsAnswer) },
  { method: "GET", url: pairsUrl(unknownAddress), response: answer(noPairsAnswer) },
  { method: "GET", url: boostsUrl, response: answer(topBoostsAnswer) },
  { method: "GET", url: boostedUrl, response: answer(boostedTokensAnswer) },
];

function sourceOver(routes: readonly ScriptedRoute[] = recorded) {
  const http = createScriptedHttp(routes);
  return { http, source: createDexscreenerSource({ http, clock: createManualClock(0) }) };
}

// The source over one answer to WBNB's pairs.
function wbnbPairsAs(body: string) {
  return sourceOver([{ method: "GET", url: pairsUrl(wbnbAddress), response: answer(body) }]).source;
}

describe("dexscreener data source", () => {
  it.each(
    marketDataSourceContract({
      create: () => ({
        source: sourceOver().source,
        known: wbnb,
        unknown: tokenOf(unknownAddress),
        uncovered: assetRefSchema.parse(`eip155:1/erc20:${wbnbAddress}`),
        down: sourceOver([]).source,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads a token's pools deepest first, with every figure exact", async () => {
    const { http, source } = sourceOver();
    const pools = await source.pools(wbnb, live);
    expect(pools).toStrictEqual({
      ok: true,
      value: [
        {
          dex: "pancakeswap",
          pool: "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE",
          base: wbnb,
          quote: usdt,
          priceUsd: { numerator: 75_374n, denominator: 100n },
          liquidityUsdMicros: 58_489_446_800_000n,
          volume24hUsdMicros: 9_412_233_100_000n,
          change24hBps: -105,
          createdAtMs: 1_619_494_741_000,
        },
        {
          dex: "pancakeswap",
          pool: "0x172fcD41E0913e95784454622d1c3724f546f849",
          base: wbnb,
          quote: usdt,
          priceUsd: { numerator: 75_257n, denominator: 100n },
          liquidityUsdMicros: 15_682_125_430_000n,
          volume24hUsdMicros: 63_177_266_800_000n,
          change24hBps: 87,
          createdAtMs: 1_680_703_943_000,
        },
        {
          dex: "pancakeswap",
          pool: "0xf2688Fb5B81049DFB7703aDa5e770543770612C4",
          base: wbnb,
          quote: usdc,
          priceUsd: { numerator: 75_180n, denominator: 100n },
          liquidityUsdMicros: 1_972_663_630_000n,
          volume24hUsdMicros: 10_331_060_790_000n,
          change24hBps: 77,
          createdAtMs: 1_681_292_327_000,
        },
      ],
    });
    expect(http.requests().map(({ url, headers }) => ({ url, headers }))).toStrictEqual([
      { url: pairsUrl(wbnbAddress), headers: undefined },
    ]);
  });

  it("asks for a token written in lowercase by its checksummed address", async () => {
    const { http, source } = sourceOver();
    const pools = await source.pools(tokenOf(wbnbAddress.toLowerCase()), live);
    expect(pools).toMatchObject({ ok: true, value: { length: 3 } });
    expect(http.requests()[0]?.url).toBe(pairsUrl(wbnbAddress));
  });

  it("reads the chain's most boosted tokens in DEX Screener's order, with their boosts", async () => {
    const { http, source } = sourceOver();
    expect(await source.trending(bsc, live)).toStrictEqual({
      ok: true,
      value: [
        {
          asset: tokenOf(firstBoosted),
          pool: {
            dex: "pancakeswap",
            pool: "0x00000000000000000000000000000000000c0ffe",
            base: tokenOf(firstBoosted),
            quote: wbnb,
            priceUsd: { numerator: 7_525n, denominator: 100_000_000n },
            liquidityUsdMicros: 84_000_250_000n,
            volume24hUsdMicros: 250_000_500_000n,
            change24hBps: 31_245,
            createdAtMs: 1_791_700_000_000,
          },
          activeBoosts: 1_500,
        },
        { asset: tokenOf(secondBoosted), activeBoosts: 500 },
      ],
    });
    expect(http.requests().map(({ url }) => url)).toStrictEqual([boostsUrl, boostedUrl]);
  });

  it("asks no pairs when no boosted token is on the chain", async () => {
    const solanaOnly = topBoostsAnswer.replaceAll('"chainId": "bsc"', '"chainId": "base"');
    const { http, source } = sourceOver([
      { method: "GET", url: boostsUrl, response: answer(solanaOnly) },
    ]);
    expect(await source.trending(bsc, live)).toStrictEqual({ ok: true, value: [] });
    expect(http.requests()).toHaveLength(1);
  });

  it("answers not_covered for another chain or an asset that is no token, asking nothing", async () => {
    const { http, source } = sourceOver();
    const expected = { ok: false, error: "not_covered" };
    expect(await source.pools(assetRefSchema.parse("eip155:56/slip44:714"), live)).toStrictEqual(
      expected,
    );
    expect(await source.pools(tokenOf("0x1234"), live)).toStrictEqual(expected);
    expect(await source.trending(chainRefSchema.parse("eip155:1"), live)).toStrictEqual(expected);
    expect(http.requests()).toHaveLength(0);
  });

  it("leaves out a pair whose quote token has no address, as the schema allows", async () => {
    const usdtAddress = '"address": "0x55d398326f99059fF775485246999027B3197955"';
    const body = wbnbPairsAnswer.replace(usdtAddress, '"address": null');
    expect(await wbnbPairsAs(body).pools(wbnb, live)).toMatchObject({
      ok: true,
      value: [
        { pool: "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE" },
        { pool: "0xf2688Fb5B81049DFB7703aDa5e770543770612C4" },
      ],
    });
  });

  it("reads figures written with an exponent exactly, and drops ones that cannot be", async () => {
    const body = `[{ "chainId": "bsc", "dexId": "pancakeswap", "pairAddress": "${"0x".padEnd(66, "a")}",
      "baseToken": { "address": "${wbnbAddress}" }, "quoteToken": { "address": "${wbnbAddress}" },
      "priceUsd": "1.5e-7", "liquidity": { "usd": 2E+3 }, "volume": { "h24": -5 },
      "priceChange": { "h24": 1e2 }, "pairCreatedAt": 1.5 }]`;
    expect(await wbnbPairsAs(body).pools(wbnb, live)).toStrictEqual({
      ok: true,
      value: [
        {
          dex: "pancakeswap",
          pool: "0x".padEnd(66, "a"),
          base: wbnb,
          quote: wbnb,
          priceUsd: { numerator: 15n, denominator: 100_000_000n },
          liquidityUsdMicros: 2_000_000_000n,
          change24hBps: 10_000,
        },
      ],
    });
  });

  it.each([
    ["a pair of another chain", wbnbPairsAnswer.replace('"chainId": "bsc"', '"chainId": "base"')],
    ["a token address that is no address", wbnbPairsAnswer.replace(wbnbAddress, "0xnot")],
    ["a pair address that is neither", wbnbPairsAnswer.replace("0x172fcD41", "0x172fcD4")],
  ])("fails as a bad answer on %s", async (_case, body) => {
    await expect(wbnbPairsAs(body).pools(wbnb, live)).rejects.toMatchObject({
      code: "dexscreener.bad_answer",
      retryable: false,
    });
  });
});
