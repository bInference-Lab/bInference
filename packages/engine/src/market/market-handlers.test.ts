import { assetRefSchema, chainRefSchema, type MarketCandle } from "@binference/chain";
import { createFakeMarketSource, type FakeMarketSourceOptions } from "@binference/chain/testing";
import { err, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import { createSourceMarketReads } from "./source-market-reads.js";

const chain = chainRefSchema.parse("fake:1");
const listed = assetRefSchema.parse("fake:1/token:0x0000000a");
const cheap = assetRefSchema.parse("fake:1/token:0x0000000b");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const hourMs = 3_600_000;
const usd = (numerator: bigint, denominator = 1n) => ({ numerator, denominator });

const pool = {
  dex: "fake-swap",
  pool: "0x0000000d",
  base: listed,
  quote: coin,
  priceUsd: usd(75_099n, 100n),
  liquidityUsdMicros: 5_000_000n,
  volume24hUsdMicros: 7_000_000n,
  change24hBps: -125,
};
const cheapPool = { ...pool, base: cheap, priceUsd: usd(7_525n, 100_000_000n) };

// A candle starting at the hour, its prices around 7.5e-5 dollars.
const candleAt = (hour: number): MarketCandle => ({
  atMs: hour * hourMs,
  open: usd(7_500n, 100_000_000n),
  high: usd(7_600n, 100_000_000n),
  low: usd(7_400n, 100_000_000n),
  close: usd(7_525n, 100_000_000n),
  volumeUsdMicros: 12_000_000n,
});

const known: FakeMarketSourceOptions = {
  id: "fake-data",
  chains: [chain],
  trending: new Map([
    [
      chain,
      [
        { asset: listed, pool, activeBoosts: 500 },
        { asset: cheap, pool: cheapPool },
        { asset: coin },
      ],
    ],
  ]),
  candles: new Map([[cheap, [1, 2, 3, 4].map(candleAt)]]),
};

async function engineOver(options: FakeMarketSourceOptions) {
  const source = createFakeMarketSource(options);
  const clock = createManualClock(0);
  const marketReads = createSourceMarketReads({ sources: [source], clock, timeoutMs: 5_000 });
  return await startTestEngine({ marketReads });
}

const trending = { chain, source: "trending" } as const;

describe("the market handlers", () => {
  it("scans the trending tokens in order, each with its figures, boosts and own price scale", async () => {
    const { engine } = await engineOver(known);
    const scan = await engine.handlers["market/scan"](testCall(trending, testCallers.mcp));
    expect(scan).toStrictEqual(
      ok({
        items: [
          {
            asset: listed,
            priceUsdMicros: 750_990_000n,
            liquidityUsdMicros: 5_000_000n,
            volume24hUsdMicros: 7_000_000n,
            change24hBps: -125,
            activeBoosts: 500,
          },
          {
            asset: cheap,
            priceUsdMicros: 7_525_000n,
            priceScale: 5,
            liquidityUsdMicros: 5_000_000n,
            volume24hUsdMicros: 7_000_000n,
            change24hBps: -125,
          },
          { asset: coin },
        ],
        assets: {
          [listed]: { symbol: "TKN", name: "Token", decimals: 6, verified: true },
          [coin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
        },
      }),
    );
  });

  it("scans at most the limit, 20 unless the call says", async () => {
    const many = Array.from({ length: 25 }, (_each, index) => ({
      asset: assetRefSchema.parse(`fake:1/token:0x${(index + 16).toString(16).padStart(8, "0")}`),
    }));
    const { engine } = await engineOver({ ...known, trending: new Map([[chain, many]]) });
    const scan = engine.handlers["market/scan"];
    const counts = await Promise.all([
      scan(testCall(trending)),
      scan(testCall({ ...trending, limit: 2 })),
    ]);
    expect(counts.map((answer) => expectOk(answer).items.length)).toStrictEqual([20, 2]);
  });

  it.each([
    [
      "a chain the registry does not hold",
      { chain: chainRefSchema.parse("fake:2"), source: "trending" },
    ],
    ["filters with trending tokens", { ...trending, filters: { launchpads: ["flap"] } }],
  ] as const)("refuses %s as bad args", async (_case, args) => {
    const { engine } = await engineOver(known);
    await expect(engine.handlers["market/scan"](testCall(args))).resolves.toStrictEqual(
      err("protocol.bad_args"),
    );
  });

  it("refuses new launches while no launch feed runs", async () => {
    const { engine } = await engineOver(known);
    const launches = { chain, source: "launches", filters: { launchpads: ["flap"] } } as const;
    await expect(engine.handlers["market/scan"](testCall(launches))).resolves.toStrictEqual(
      err("market.no_launch_feed"),
    );
  });

  it.each([
    [
      "no source knows anything",
      { ...known, trending: new Map(), candles: new Map() },
      "market.no_data",
    ],
    ["the source is down", { ...known, isDown: true }, "market.source_down"],
  ] as const)("fails a scan and a chart when %s", async (_case, options, code) => {
    const { engine } = await engineOver(options);
    const chart = { asset: cheap, interval: "1h" } as const;
    await expect(engine.handlers["market/scan"](testCall(trending))).resolves.toStrictEqual(
      err(code),
    );
    await expect(engine.handlers["market/chart"](testCall(chart))).resolves.toStrictEqual(
      err(code),
    );
  });

  it("charts a cheap token's candles oldest first, priced for 10^5 tokens, naming the source", async () => {
    const { engine } = await engineOver(known);
    const args = { asset: cheap, interval: "1h", to: 4 * hourMs, limit: 2 } as const;
    await expect(engine.handlers["market/chart"](testCall(args))).resolves.toStrictEqual(
      ok({
        asset: cheap,
        interval: "1h",
        candles: [2, 3].map((hour) => ({
          at: hour * hourMs,
          openUsdMicros: 7_500_000n,
          highUsdMicros: 7_600_000n,
          lowUsdMicros: 7_400_000n,
          closeUsdMicros: 7_525_000n,
          volumeUsdMicros: 12_000_000n,
        })),
        priceScale: 5,
        source: "fake-data",
      }),
    );
  });

  it("charts the newest 100 candles up to now unless the call says", async () => {
    const hours = Array.from({ length: 120 }, (_each, index) => index + 1);
    const { engine } = await engineOver({
      ...known,
      candles: new Map([[cheap, hours.map(candleAt)]]),
    });
    const chart = await engine.handlers["market/chart"](testCall({ asset: cheap, interval: "1h" }));
    expect(expectOk(chart).candles.map((candle) => candle.at / hourMs)).toStrictEqual(
      hours.slice(20),
    );
  });
});
