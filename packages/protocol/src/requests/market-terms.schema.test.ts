import { describe, expect, it } from "vitest";
import { refs } from "../examples/wire-values.js";
import { launchFilterSchema } from "../views/launch-filter.schema.js";
import { marketTermFields } from "./market-terms.schema.js";

const { scanFilter, interval, asset, account, chain } = marketTermFields;

describe("the market term fields", () => {
  it("take every launch filter field but a least liquidity", () => {
    const filter = {
      launchpads: ["flap"],
      quoteTokens: [refs.native],
      maxTaxBps: 500,
      maxSnipeTaxBps: 9_000,
      minCurveProgressBps: 1_000,
      maxInsiders: 3,
      maxCreatorLaunches30d: 2,
    };
    expect(scanFilter.parse(filter)).toStrictEqual(filter);
    expect(scanFilter.safeParse({ minLiquidityUsdMicros: "1000000" }).success).toBe(false);
    expect(launchFilterSchema.parse({ minLiquidityUsdMicros: "1000000" })).toStrictEqual({
      minLiquidityUsdMicros: 1_000_000n,
    });
  });

  it("read the protocol's refs and candle widths", () => {
    expect(chain.parse(refs.chain)).toBe(refs.chain);
    expect(asset.parse(refs.token)).toBe(refs.token);
    expect(account.parse(refs.account)).toBe(refs.account);
    expect(interval.parse("4h")).toBe("4h");
    expect(interval.safeParse("2h").success).toBe(false);
  });
});
