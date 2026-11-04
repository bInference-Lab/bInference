import { describe, expect, it } from "vitest";
import { bySkipCount, type SkipCount } from "./fill-counts.js";

describe("an order's skip counts", () => {
  it("list the most skipped reason first, and equal counts by reason code", () => {
    const counts: readonly SkipCount[] = [
      { reason: "no_price", count: 2 },
      { reason: "late", count: 5 },
      { reason: "fill_failed", count: 2 },
    ];

    expect(counts.toSorted(bySkipCount)).toStrictEqual([
      { reason: "late", count: 5 },
      { reason: "fill_failed", count: 2 },
      { reason: "no_price", count: 2 },
    ]);
    expect(counts.toReversed().toSorted(bySkipCount)).toStrictEqual(counts.toSorted(bySkipCount));
  });
});
