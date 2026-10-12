import { assetRefSchema } from "@binference/chain";
import { poolSource } from "@binference/chain-evm";
import type { PriceCheck } from "@binference/engine/market";
import { describe, expect, it } from "vitest";
import type { LatestPrice } from "./chain-watch.js";
import { isConfirmed, isUrgent } from "./price-confirmation.js";

const token = assetRefSchema.parse("eip155:56/erc20:0x0000000000000000000000000000000000000001");
const plan = "pools:0x0000000000000000000000000000000000000002";
const nowMs = 1_000_000;
// A pool chosen at 400,000 ms, $50,000 deep.
const deep: LatestPrice = {
  token,
  block: 100n,
  atMs: nowMs,
  source: poolSource,
  plan,
  depthUsdMicros: 50_000_000_000n,
  quoteAsset: assetRefSchema.parse("eip155:56/slip44:714"),
  quotePrice: { numerator: 1n, denominator: 300n },
  planSinceMs: 400_000,
};
const thin: LatestPrice = { ...deep, depthUsdMicros: 24_999_999_999n };
const checkAt = (atMs: number, found: Partial<PriceCheck> = {}): PriceCheck => ({
  token,
  source: "dexscreener",
  gapBps: 10,
  isGap: false,
  atMs,
  plan,
  ...found,
});

describe("price confirmation", () => {
  it("confirms a launchpad's curve price as read", () => {
    const curve = { ...deep, source: "flap" };
    expect([isConfirmed(curve, [], nowMs), isUrgent(curve, [], nowMs)]).toStrictEqual([
      true,
      false,
    ]);
  });

  it("confirms a pool's price once a check after the pool was chosen found no gap", () => {
    expect(isConfirmed(deep, [], nowMs)).toBe(false);
    expect(isConfirmed(deep, [checkAt(399_999)], nowMs)).toBe(false);
    expect(isConfirmed(deep, [checkAt(400_000)], nowMs)).toBe(true);
    expect(isConfirmed(deep, [checkAt(500_000, { plan: "pools:other" })], nowMs)).toBe(false);
    expect(isUrgent(deep, [], nowMs)).toBe(true);
    expect(isUrgent(deep, [checkAt(400_000)], nowMs)).toBe(false);
  });

  it("confirms nothing while a source's last check found a gap", () => {
    const checks = [checkAt(500_000), checkAt(600_000, { source: "geckoterminal", isGap: true })];
    expect(isConfirmed(deep, checks, nowMs)).toBe(false);
  });

  it("asks a thin pool for a check from the last 5 minutes, and keeps it urgent", () => {
    expect(isConfirmed(thin, [checkAt(699_999)], nowMs)).toBe(false);
    expect(isConfirmed(thin, [checkAt(700_000)], nowMs)).toBe(true);
    expect(isUrgent(thin, [checkAt(700_000)], nowMs)).toBe(true);
  });
});
