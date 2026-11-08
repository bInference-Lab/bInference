import { describe, expect, it } from "vitest";
import { scaleFor } from "./page-picture.js";

describe("scaleFor", () => {
  it("draws a page at 96 dpi when that fits its pixels", () => {
    expect(scaleFor(612, 792, 4_000_000)).toBe(96 / 72);
  });

  it("draws a page smaller to stay within its pixels", () => {
    const scale = scaleFor(3_000, 4_000, 1_000_000);
    expect(3_000 * scale * 4_000 * scale).toBeCloseTo(1_000_000);
  });

  it("keeps the longer edge within 10,000 pixels", () => {
    expect(20_000 * scaleFor(20_000, 10, 4_000_000)).toBeCloseTo(10_000);
  });

  it("draws nothing for a page with no area or no pixels left", () => {
    expect([scaleFor(0, 792, 4_000_000), scaleFor(612, 792, 0)]).toStrictEqual([0, 0]);
  });
});
