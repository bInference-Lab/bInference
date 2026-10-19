import { accountRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { activityItemSchema, type LaunchFilter, launchViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testCoin, testToken } from "../intents/test-intents.js";
import { launchPasses, priceMeets, tradeMatches } from "./alert-matches.js";

const hash = `0x${"ef".repeat(32)}`;
const account = accountRefSchema.parse("fake:1:0x0000aaaa");
const bps = (value: number) => bpsSchema.parse(value);
const whole = (micros: bigint) => ({ numerator: micros, denominator: 1n });

const launch = launchViewSchema.parse({
  chain: "fake:1",
  token: "fake:1/token:0x0000cafe",
  launchpad: "fake",
  creator: "fake:1:0x0000beef",
  quoteToken: testCoin,
  taxBps: 300,
  curveProgressBps: 5_000,
  graduated: false,
  insiders: ["fake:1:0x00000001"],
  creatorLaunches30d: 2,
  block: 1,
  tx: hash,
  launchedAt: 1,
});

describe("priceMeets", () => {
  const level = { kind: "price", asset: testToken, price: 1_000_000n } as const;

  it("meets a level at it and past it, never short of it", () => {
    const above = { ...level, direction: "above" } as const;
    const below = { ...level, direction: "below" } as const;

    expect(
      [999_999n, 1_000_000n, 1_000_001n].map((micros) => priceMeets(above, whole(micros))),
    ).toStrictEqual([false, true, true]);
    expect(
      [999_999n, 1_000_000n, 1_000_001n].map((micros) => priceMeets(below, whole(micros))),
    ).toStrictEqual([true, true, false]);
  });
});

describe("tradeMatches", () => {
  const sale = activityItemSchema.parse({
    at: 1,
    block: 1,
    tx: hash,
    side: "sell",
    asset: testToken,
    amount: "1",
    counterAsset: testCoin,
    counterAmount: "1",
    valueUsdMicros: "5000000",
  });

  it("matches the account's trades of the side, asset and least value it names", () => {
    const base = { kind: "wallet", account } as const;
    const other = accountRefSchema.parse("fake:1:0x0000bbbb");

    expect(tradeMatches(base, { account, activity: sale })).toBe(true);
    expect(tradeMatches(base, { account: other, activity: sale })).toBe(false);
    expect(tradeMatches({ ...base, side: "buy" }, { account, activity: sale })).toBe(false);
    expect(tradeMatches({ ...base, asset: testCoin }, { account, activity: sale })).toBe(false);
    expect(tradeMatches({ ...base, minUsdMicros: 5_000_001n }, { account, activity: sale })).toBe(
      false,
    );
  });

  it("never meets a least value with a trade nothing valued", () => {
    const { valueUsdMicros: _value, ...unvalued } = sale;
    const condition = { kind: "wallet", account, minUsdMicros: 1n } as const;

    expect(tradeMatches(condition, { account, activity: unvalued })).toBe(false);
  });
});

describe("launchPasses", () => {
  it("passes every launch with an empty filter", () => {
    expect(launchPasses({}, { launch })).toBe(true);
  });

  it("holds every field given", () => {
    const judged = { launch, liquidityUsdMicros: 10_000_000n };
    const passing = {
      launchpads: ["fake"],
      quoteTokens: [testCoin],
      maxTaxBps: bps(300),
      minCurveProgressBps: bps(5_000),
      minLiquidityUsdMicros: 10_000_000n,
      maxInsiders: 1,
      maxCreatorLaunches30d: 2,
    };

    expect(launchPasses(passing, judged)).toBe(true);
    const breaking: readonly LaunchFilter[] = [
      { launchpads: ["other"] },
      { quoteTokens: [testToken] },
      { maxTaxBps: bps(299) },
      { minCurveProgressBps: bps(5_001) },
      { minLiquidityUsdMicros: 10_000_001n },
      { maxInsiders: 0 },
      { maxCreatorLaunches30d: 1 },
    ];
    expect(breaking.map((broken) => launchPasses({ ...passing, ...broken }, judged))).toStrictEqual(
      [false, false, false, false, false, false, false],
    );
  });

  it("never passes a bound on a value the feed did not read, and counts a graduated curve full", () => {
    const { taxBps: _tax, ...untaxed } = launch;

    expect(launchPasses({ maxTaxBps: bps(10_000) }, { launch: untaxed })).toBe(false);
    expect(launchPasses({ minLiquidityUsdMicros: 1n }, { launch })).toBe(false);
    expect(
      launchPasses(
        { minCurveProgressBps: bps(10_000) },
        { launch: { ...launch, graduated: true } },
      ),
    ).toBe(true);
  });
});
