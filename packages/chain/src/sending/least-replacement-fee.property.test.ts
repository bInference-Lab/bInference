import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { leastReplacementFee } from "./least-replacement-fee.js";

// Whether a fee replaces one of `replaced` at its nonce: above it, and at least 10% above it.
const replaces = (fee: bigint, replaced: bigint): boolean =>
  fee > replaced && fee * 10n >= replaced * 11n;

describe("the least fee of a replacement", () => {
  it("is the smallest fee above the replaced one by at least 10%", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 256n }), (fee) => {
        const least = leastReplacementFee(fee);
        expect(replaces(least, fee)).toBe(true);
        expect(replaces(least - 1n, fee)).toBe(false);
      }),
    );
  });

  it.each([
    [0n, 1n],
    [1n, 2n],
    [10n, 11n],
    [50_000_000n, 55_000_000n],
  ])("raises %s to %s", (fee, least) => {
    expect(leastReplacementFee(fee)).toBe(least);
  });
});
