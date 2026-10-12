import { type AssetRef, assetRefSchema, chainRefSchema, type MarketPool } from "@binference/chain";
import { createFakeMarketSource, type FakeMarketSourceOptions } from "@binference/chain/testing";
import { err, ok } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { marketReadsContract } from "../contracts/market-reads-contract.js";
import { createSourceMarketReads } from "./source-market-reads.js";

const chain = chainRefSchema.parse("fake:1");
const known = assetRefSchema.parse("fake:1/token:0x0000000a");
const other = assetRefSchema.parse("fake:1/token:0x0000000b");
const unknown = assetRefSchema.parse("fake:1/token:0x0000000f");
const live = { signal: new AbortController().signal };

const poolOf = (base: AssetRef, liquidityUsdMicros: bigint): MarketPool => ({
  dex: "fake-swap",
  pool: "0x0000000d",
  base,
  quote: assetRefSchema.parse("fake:1/slip44:1"),
  liquidityUsdMicros,
});

const price = { numerator: 3n, denominator: 2n };
const candle = { atMs: 0, open: price, high: price, low: price, close: price, volumeUsdMicros: 1n };
const fourHours = { interval: "4h", limit: 3 } as const;

const first: FakeMarketSourceOptions = {
  id: "first",
  chains: [chain],
  pools: new Map([[known, [poolOf(known, 5n)]]]),
  trending: new Map([[chain, [{ asset: known }]]]),
  candles: new Map([[known, [candle]]]),
};
const second: FakeMarketSourceOptions = {
  id: "second",
  chains: [chain],
  pools: new Map([
    [known, [poolOf(known, 9n)]],
    [other, [poolOf(other, 7n)]],
  ]),
};

function readsOver(sources: readonly FakeMarketSourceOptions[], clock = createManualClock(0)) {
  const fakes = sources.map((options) => createFakeMarketSource(options));
  return { fakes, reads: createSourceMarketReads({ sources: fakes, clock, timeoutMs: 5_000 }) };
}

describe("source market reads", () => {
  it.each(
    marketReadsContract({
      create: () => ({
        reads: readsOver([first, second]).reads,
        known,
        unknown,
        down: readsOver([{ ...first, isDown: true }]).reads,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("answers from the first source that knows something, asking no further", async () => {
    const { fakes, reads } = readsOver([first, second]);
    expect(await reads.pools(known, live)).toStrictEqual(
      ok({ source: "first", items: [poolOf(known, 5n)] }),
    );
    expect(fakes.map((fake) => fake.reads())).toStrictEqual([1, 0]);
  });

  it.each([
    ["knows nothing of the token", first],
    ["is down", { ...first, isDown: true }],
    ["does not serve the chain", { ...first, chains: [chainRefSchema.parse("fake:2")] }],
  ])("asks the next source when one %s", async (_case, before) => {
    expect(await readsOver([before, second]).reads.pools(other, live)).toStrictEqual(
      ok({ source: "second", items: [poolOf(other, 7n)] }),
    );
  });

  it("answers source_down, not no_data, when a source that might know was down", async () => {
    const { reads } = readsOver([{ ...first, isDown: true }, second]);
    expect(await reads.pools(unknown, live)).toStrictEqual(err("source_down"));
    expect(await reads.trending(chain, live)).toStrictEqual(err("source_down"));
  });

  it("asks for a chart only the sources that read candles, in order", async () => {
    const { fakes, reads } = readsOver([second, first]);
    expect(await reads.chart(known, fourHours, live)).toStrictEqual(
      ok({ source: "first", items: [candle] }),
    );
    expect(fakes.map((fake) => fake.reads())).toStrictEqual([0, 1]);
  });

  it("asks for a chart the chart sources it is given, and the others for the rest", async () => {
    const clock = createManualClock(0);
    const pools = createFakeMarketSource(second);
    const charts = createFakeMarketSource(first);
    const reads = createSourceMarketReads({
      sources: [pools],
      chartSources: [charts],
      clock,
      timeoutMs: 5_000,
    });
    expect(await reads.pools(known, live)).toMatchObject(ok({ source: "second" }));
    expect(await reads.chart(known, fourHours, live)).toMatchObject(ok({ source: "first" }));
    expect([pools.reads(), charts.reads()]).toStrictEqual([1, 1]);
  });

  it("answers no_data for a chart when no source reads candles", async () => {
    const { fakes, reads } = readsOver([second]);
    expect(await reads.chart(known, fourHours, live)).toStrictEqual(err("no_data"));
    expect(fakes.map((fake) => fake.reads())).toStrictEqual([0]);
  });

  it("counts a source that does not answer within the timeout as down", async () => {
    const clock = createManualClock(0);
    const silent = {
      id: "silent",
      pools: async (_asset: AssetRef, options: { readonly signal: AbortSignal }) =>
        await new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(new Error("never answered"));
          });
        }),
      trending: async () => await Promise.resolve(ok([])),
    };
    const reads = createSourceMarketReads({ sources: [silent], clock, timeoutMs: 5_000 });
    const read = reads.pools(known, live);
    await clock.advance(5_000);
    expect(await read).toStrictEqual(err("source_down"));
  });
});
