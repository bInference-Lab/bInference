import {
  type AssetRef,
  assetRefSchema,
  type CandleRequest,
  chainRefSchema,
  type HttpResponse,
  type MarketCandle,
  type MarketDataSource,
  type Ratio,
} from "@binference/plugin-sdk";
import {
  createManualClock,
  createScriptedHttp,
  marketCandlesContract,
  marketDataSourceContract,
  marketPricesContract,
  type ScriptedRoute,
  successOf,
} from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createGeckoterminalSource } from "./geckoterminal-source.js";
import {
  tokenNotFoundAnswer,
  trendingAddresses,
  trendingPoolsAnswer,
  wbnbAddress,
  wbnbDeepestPool,
  wbnbOhlcvAnswer,
  wbnbPoolsAnswer,
  wbnbTokensAnswer,
} from "./testing/recorded-answers.js";

const origin = "https://api.geckoterminal.com/api/v2";
const bsc = chainRefSchema.parse("eip155:56");
const unknownAddress = "0x000000000000000000000000000000000000dEaD";
const tokenOf = (address: string) => assetRefSchema.parse(`eip155:56/erc20:${address}`);
const wbnb = tokenOf(wbnbAddress);
const usdt = tokenOf("0x55d398326f99059fF775485246999027B3197955");
const unknown = tokenOf(unknownAddress);
const uncovered = assetRefSchema.parse(`eip155:1/erc20:${wbnbAddress}`);
const poolsUrl = (address: string): string => `${origin}/networks/bsc/tokens/${address}/pools`;
const ohlcvUrl = (extra = ""): string =>
  `${origin}/networks/bsc/pools/${wbnbDeepestPool}/ohlcv/hour?aggregate=4&limit=3&currency=usd` +
  `&token=${wbnbAddress.toLowerCase()}&include_empty_intervals=true${extra}`;
const priceUrl = `${origin}/networks/bsc/tokens/multi/${wbnbAddress},${unknownAddress}`;
const live = { signal: new AbortController().signal };
const fourHours = { interval: "4h" as const, limit: 3 };
const hourMs = 3_600_000;
const startMs = Date.UTC(2026, 9, 12, 9, 0, 0);

function answer(body: string, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

const route = (url: string, body: string, status = 200): ScriptedRoute => ({
  method: "GET",
  url,
  response: answer(body, status),
});

const recorded: readonly ScriptedRoute[] = [
  route(poolsUrl(wbnbAddress), wbnbPoolsAnswer),
  route(poolsUrl(unknownAddress), tokenNotFoundAnswer, 404),
  route(ohlcvUrl(), wbnbOhlcvAnswer),
  route(`${origin}/networks/bsc/trending_pools`, trendingPoolsAnswer),
  route(priceUrl, wbnbTokensAnswer),
  route(`${origin}/networks/bsc/tokens/multi/${wbnbAddress}`, wbnbTokensAnswer),
];

function sourceOver(routes: readonly ScriptedRoute[] = recorded) {
  const http = createScriptedHttp(routes);
  const clock = createManualClock(startMs);
  return { http, clock, source: createGeckoterminalSource({ http, clock }) };
}

// The source's candles of a token, from a read that must succeed.
async function candlesOf(
  source: MarketDataSource,
  asset: AssetRef,
  request: CandleRequest,
): Promise<readonly MarketCandle[]> {
  const read = source.candles;
  if (read === undefined) {
    throw new Error("The source reads no candles.");
  }
  return successOf(await read(asset, request, live));
}

// The source's prices of tokens on BNB Smart Chain, from a read that must succeed.
async function pricesOf(
  source: MarketDataSource,
  assets: readonly AssetRef[],
): Promise<ReadonlyMap<AssetRef, Ratio>> {
  const read = source.prices;
  if (read === undefined) {
    throw new Error("The source reads no prices.");
  }
  return successOf(await read(bsc, assets, live));
}

const harness = {
  create: () => ({
    source: sourceOver().source,
    known: wbnb,
    unknown,
    uncovered,
    down: sourceOver([]).source,
  }),
};

describe("geckoterminal data source", () => {
  it.each([
    ...marketDataSourceContract(harness),
    ...marketCandlesContract(harness),
    ...marketPricesContract(harness),
  ])("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads a token's pools deepest first, with every figure exact", async () => {
    const pools = successOf(await sourceOver().source.pools(wbnb, live));
    expect(pools.map((pool) => pool.pool)).toStrictEqual([
      "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE",
      "0x6bbc40579ad1BBD243895cA0ACB086BB6300d636",
      "0x172fcD41E0913e95784454622d1c3724f546f849",
    ]);
    expect(pools[0]).toStrictEqual({
      dex: "pancakeswap_v2",
      pool: "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE",
      base: usdt,
      quote: wbnb,
      priceUsd: { numerator: 10_006_451_335n, denominator: 10_000_000_000n },
      liquidityUsdMicros: 58_334_444_308_500n,
      volume24hUsdMicros: 3_858_571_990_065n,
      createdAtMs: Date.UTC(2021, 6, 15, 7, 20, 16),
    });
  });

  it("reads a token's candles from its deepest pool, oldest first, every figure exact", async () => {
    const { http, source } = sourceOver();
    const candles = await candlesOf(source, wbnb, fourHours);
    expect(candles.map((candle) => candle.atMs)).toStrictEqual([
      1_791_763_200_000, 1_791_777_600_000, 1_791_792_000_000,
    ]);
    expect(candles[0]).toStrictEqual({
      atMs: 1_791_763_200_000,
      open: { numerator: 75_347n, denominator: 100n },
      high: { numerator: 75_463n, denominator: 100n },
      low: { numerator: 74_996n, denominator: 100n },
      close: { numerator: 75_083n, denominator: 100n },
      volumeUsdMicros: 462_391_110_553n,
    });
    expect(http.requests().map(({ url }) => url)).toStrictEqual([
      poolsUrl(wbnbAddress),
      ohlcvUrl(),
    ]);
  });

  it("keeps a token's chart pool ten minutes, then picks it again", async () => {
    const { http, clock, source } = sourceOver();
    await candlesOf(source, wbnb, fourHours);
    await clock.advance(599_999);
    await candlesOf(source, wbnb, fourHours);
    await clock.advance(1);
    await candlesOf(source, wbnb, fourHours);
    expect(http.requests().map(({ url }) => url)).toStrictEqual([
      poolsUrl(wbnbAddress),
      ohlcvUrl(),
      ohlcvUrl(),
      poolsUrl(wbnbAddress),
      ohlcvUrl(),
    ]);
  });

  it("asks for the candles before a time and keeps only those that start before it", async () => {
    const beforeMs = 1_791_792_000_000;
    const { source } = sourceOver([
      route(poolsUrl(wbnbAddress), wbnbPoolsAnswer),
      route(ohlcvUrl("&before_timestamp=1791792000"), wbnbOhlcvAnswer),
    ]);
    const candles = await candlesOf(source, wbnb, { ...fourHours, beforeMs });
    expect(candles.map((candle) => candle.atMs)).toStrictEqual([
      beforeMs - 8 * hourMs,
      beforeMs - 4 * hourMs,
    ]);
  });

  it("reads no candles of a token with no pool, and asks for none", async () => {
    const { http, source } = sourceOver();
    await expect(candlesOf(source, unknown, fourHours)).resolves.toStrictEqual([]);
    expect(http.requests()).toHaveLength(1);
  });

  it("fails as a bad answer when the candles price another token", async () => {
    const other = wbnbOhlcvAnswer.replace(
      '"address": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"',
      '"address": "0x55d398326f99059ff775485246999027b3197955"',
    );
    const { source } = sourceOver([
      route(poolsUrl(wbnbAddress), wbnbPoolsAnswer),
      route(ohlcvUrl(), other),
    ]);
    await expect(candlesOf(source, wbnb, fourHours)).rejects.toMatchObject({
      code: "geckoterminal.bad_answer",
    });
  });

  it("fails as a bad answer on a candle whose figures are no prices", async () => {
    const negative = wbnbOhlcvAnswer.replace("753.96, 753.972475788138", "-753.96, 753.97");
    const { source } = sourceOver([
      route(poolsUrl(wbnbAddress), wbnbPoolsAnswer),
      route(ohlcvUrl(), negative),
    ]);
    await expect(candlesOf(source, wbnb, fourHours)).rejects.toMatchObject({
      code: "geckoterminal.bad_answer",
    });
  });

  it("reads each trending pool's base token once, in GeckoTerminal's order, with its pool", async () => {
    const trending = successOf(await sourceOver().source.trending(bsc, live));
    const [first, second] = trendingAddresses;
    expect(trending).toHaveLength(2);
    expect(trending).toMatchObject([
      { asset: tokenOf(first), pool: { pool: "0x66f289De31EEF70d52186729d2637Ac978CFC56B" } },
      { asset: tokenOf(second), pool: { pool: "0xD0e226f674bBf064f54aB47F42473fF80DB98CBA" } },
    ]);
    expect(trending[1]).not.toHaveProperty("pool.createdAtMs");
  });

  it("prices only the tokens of the chain asked, exactly, in one request", async () => {
    const { http, source } = sourceOver();
    const coin = assetRefSchema.parse("eip155:56/slip44:714");
    await expect(pricesOf(source, [wbnb, coin, uncovered])).resolves.toStrictEqual(
      new Map([[wbnb, { numerator: 75_008n, denominator: 100n }]]),
    );
    expect(http.requests()).toHaveLength(1);
    await expect(pricesOf(source, [])).resolves.toStrictEqual(new Map());
    expect(http.requests()).toHaveLength(1);
  });
});
