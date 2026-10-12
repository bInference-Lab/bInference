import { assetRefSchema, type MarketDataSource } from "@binference/chain";
import { createFakeMarketSource } from "@binference/chain/testing";
import { BinferenceError, type Ratio } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import {
  createPriceCrossCheck,
  gapBpsOf,
  type PriceCheck,
  type PriceSample,
} from "./price-cross-check.js";

const chain = "fake:1";
const tokenOf = (index: number) =>
  assetRefSchema.parse(`${chain}/token:0x${String(index).padStart(8, "0")}`);
const signal = new AbortController().signal;
// $2 for one whole token of 18 decimals: 2,000,000 micro-dollars for 10^18 base units.
const twoDollars: Ratio = { numerator: 2_000_000n, denominator: 10n ** 18n };
const sampleOf = (index: number, usdPrice: Ratio = twoDollars): PriceSample => ({
  token: tokenOf(index),
  usdPrice,
  decimals: 18,
});

describe("price cross-check", () => {
  it("measures the gap in basis points of the source's price", () => {
    expect(gapBpsOf(sampleOf(1), { numerator: 2n, denominator: 1n })).toBe(0n);
    expect(gapBpsOf(sampleOf(1), { numerator: 5n, denominator: 2n })).toBe(2_000n);
    expect(gapBpsOf(sampleOf(1), { numerator: 1n, denominator: 1n })).toBe(10_000n);
    expect(gapBpsOf(sampleOf(1), { numerator: 1n, denominator: 10n ** 9n })).toBe(1_000_000n);
    expect(gapBpsOf(sampleOf(1), { numerator: 0n, denominator: 1n })).toBe(1_000_000n);
    expect(
      gapBpsOf({ ...sampleOf(1), decimals: 6 }, { numerator: 2n, denominator: 10n ** 12n }),
    ).toBe(0n);
  });

  it("flags a token whose price is the limit or more away from a source's, once", async () => {
    const clock = createManualClock(0);
    const source = createFakeMarketSource({
      id: "screener",
      chains: [chain as never],
      prices: new Map([
        [tokenOf(1), { numerator: 2n, denominator: 1n }],
        [tokenOf(2), { numerator: 22n, denominator: 10n }],
      ]),
    });
    const gaps: PriceCheck[] = [];
    const check = createPriceCrossCheck({
      sources: [{ source, everyMs: 60_000, maxTokens: 30 }],
      samples: () => [sampleOf(1), sampleOf(2), sampleOf(3)],
      watched: () => [1, 2, 3].map(tokenOf),
      gapLimitBps: 500,
      clock,
      onGap: (found) => gaps.push(found),
      onSourceFailed: () => undefined,
    });
    await check.tick({ signal });
    await clock.advance(60_000);
    await check.tick({ signal });
    expect(gaps).toStrictEqual([
      { token: tokenOf(2), source: "screener", gapBps: 909, isGap: true, atMs: 0 },
    ]);
    expect(check.hasGap(tokenOf(2))).toBe(true);
    expect(check.hasGap(tokenOf(1))).toBe(false);
    expect(check.checks().map(({ token, atMs }) => [token, atMs])).toStrictEqual([
      [tokenOf(1), 60_000],
      [tokenOf(2), 60_000],
    ]);
    expect(source.reads()).toBe(2);
  });

  it("asks each source at its own pace, the tokens it checked longest ago first", async () => {
    const clock = createManualClock(0);
    const prices = new Map(
      [1, 2, 3].map((index) => [tokenOf(index), { numerator: 2n, denominator: 1n }]),
    );
    const fast = createFakeMarketSource({ id: "fast", chains: [chain as never], prices });
    const slow = createFakeMarketSource({ id: "slow", chains: [chain as never], prices });
    const check = createPriceCrossCheck({
      sources: [
        { source: fast, everyMs: 60_000, maxTokens: 2 },
        { source: slow, everyMs: 300_000, maxTokens: 2 },
      ],
      samples: () => [sampleOf(1), sampleOf(2), sampleOf(3)],
      watched: () => [1, 2, 3].map(tokenOf),
      gapLimitBps: 1_000,
      clock,
      onGap: () => undefined,
      onSourceFailed: () => undefined,
    });
    await check.tick({ signal });
    await clock.advance(60_000);
    await check.tick({ signal });
    expect([fast.reads(), slow.reads()]).toStrictEqual([2, 1]);
    const fastChecks = check.checks().filter(({ source }) => source === "fast");
    expect(fastChecks.map(({ token, atMs }) => [token, atMs])).toStrictEqual([
      [tokenOf(1), 60_000],
      [tokenOf(2), 0],
      [tokenOf(3), 60_000],
    ]);
  });

  it("hears a source that fails or does not serve the chain, and finds nothing where a source has no prices", async () => {
    const clock = createManualClock(0);
    const down = createFakeMarketSource({
      id: "down",
      chains: [chain as never],
      prices: new Map(),
      isDown: true,
    });
    const plain: MarketDataSource = createFakeMarketSource({
      id: "plain",
      chains: [chain as never],
    });
    const elsewhere = createFakeMarketSource({
      id: "elsewhere",
      chains: ["fake:9" as never],
      prices: new Map([[tokenOf(1), { numerator: 2n, denominator: 1n }]]),
    });
    const failed: string[] = [];
    const check = createPriceCrossCheck({
      sources: [
        { source: down, everyMs: 60_000, maxTokens: 30 },
        { source: plain, everyMs: 60_000, maxTokens: 30 },
        { source: elsewhere, everyMs: 60_000, maxTokens: 30 },
      ],
      samples: () => [sampleOf(1)],
      watched: () => [tokenOf(1)],
      gapLimitBps: 1_000,
      clock,
      onGap: () => undefined,
      onSourceFailed: (source, code) => failed.push(`${source} ${code}`),
    });
    await check.tick({ signal });
    expect(failed).toStrictEqual(["elsewhere market.not_covered", "down down.unavailable"]);
    expect(check.checks()).toStrictEqual([]);
    expect(elsewhere.reads()).toBe(1);
  });

  it("checks urgent samples first, and carries each sample's plan to its check", async () => {
    const clock = createManualClock(0);
    const prices = new Map(
      [1, 2, 3].map((index) => [tokenOf(index), { numerator: 2n, denominator: 1n }]),
    );
    const source = createFakeMarketSource({ id: "screener", chains: [chain as never], prices });
    const samples = { urgent: 0 };
    const check = createPriceCrossCheck({
      sources: [{ source, everyMs: 60_000, maxTokens: 1 }],
      samples: () =>
        [1, 2, 3].map((index): PriceSample => ({
          token: tokenOf(index),
          usdPrice: twoDollars,
          decimals: 18,
          plan: `plan ${index}`,
          isUrgent: index === samples.urgent,
        })),
      watched: () => [1, 2, 3].map(tokenOf),
      gapLimitBps: 1_000,
      clock,
      onGap: () => undefined,
      onSourceFailed: () => undefined,
    });
    await check.tick({ signal });
    samples.urgent = 1;
    await clock.advance(60_000);
    await check.tick({ signal });
    expect(check.checks()).toStrictEqual([
      {
        token: tokenOf(1),
        source: "screener",
        gapBps: 0,
        isGap: false,
        atMs: 60_000,
        plan: "plan 1",
      },
    ]);
  });

  it("forgets the checks of a token no longer watched", async () => {
    const clock = createManualClock(0);
    const source = createFakeMarketSource({
      id: "screener",
      chains: [chain as never],
      prices: new Map([[tokenOf(1), { numerator: 5n, denominator: 1n }]]),
    });
    const watching = { tokens: [tokenOf(1)] };
    const check = createPriceCrossCheck({
      sources: [{ source, everyMs: 60_000, maxTokens: 30 }],
      samples: () => [sampleOf(1)].filter(({ token }) => watching.tokens.includes(token)),
      watched: () => watching.tokens,
      gapLimitBps: 1_000,
      clock,
      onGap: () => undefined,
      onSourceFailed: () => undefined,
    });
    await check.tick({ signal });
    expect(check.hasGap(tokenOf(1))).toBe(true);
    watching.tokens = [];
    await check.tick({ signal });
    expect([check.checks(), check.hasGap(tokenOf(1))]).toStrictEqual([[], false]);
  });

  it("stops with the signal's reason", async () => {
    const check = createPriceCrossCheck({
      sources: [],
      samples: () => [],
      watched: () => [],
      gapLimitBps: 1_000,
      clock: createManualClock(0),
      onGap: () => undefined,
      onSourceFailed: () => undefined,
    });
    const reason = new BinferenceError({ code: "test.stopped", message: "stopped" });
    await expect(check.tick({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });
});
