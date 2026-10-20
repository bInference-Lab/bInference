import { describe, expect, it } from "vitest";
import { startTickOf } from "./start-tick.js";

const supplyBase = 10n ** 27n;
const ether = 10n ** 18n;
const startOf = (marketCapBase: bigint) => startTickOf({ marketCapBase, supplyBase, spacing: 200 });

describe("a Brew pool's starting tick", () => {
  it("starts 8 BNB and 5,000 USDT at the ticks Brew's own launches use", () => {
    expect(startOf(8n * ether)).toBe(-186_600);
    expect(startOf(5_000n * ether)).toBe(-122_200);
  });

  it("rounds down to the spacing, so the start is at the market cap or a step below it", () => {
    const tick = -186_600;
    expect(Math.abs(tick % 200)).toBe(0);
    expect(startOf(8n * ether + 1n)).toBe(tick);
    expect(startOf(16n * ether)).toBeGreaterThan(tick);
  });

  it("is none for a market cap no tick inside the factory's bounds reaches", () => {
    expect(startOf(0n)).toBeUndefined();
    expect(startOf(10n ** 70n)).toBeUndefined();
  });
});
