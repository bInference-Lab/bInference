import { describe, expect, it } from "vitest";
import { priceImpactOf } from "./price-impact.js";

describe("okx price impact", () => {
  it.each([
    ["-0.12", 12],
    ["-1.234", 124],
    ["-5", 500],
    ["-0.001", 1],
    ["-0", 0],
    ["0.35", 0],
    ["-150.5", 10_000],
  ])("reads %s percent as %i basis points lost, rounded up", (percent, bps) => {
    expect(priceImpactOf(percent)).toBe(bps);
  });

  it.each([undefined, "", "n/a", "1e-3", "--1"])(
    "counts an impact OKX cannot tell, %s, as the whole input",
    (percent) => {
      expect(priceImpactOf(percent)).toBe(10_000);
    },
  );
});
