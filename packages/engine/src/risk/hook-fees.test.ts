import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  type VenueQuote,
} from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { routeHookFeeBps, routeHooksOf } from "./hook-fees.js";

const hook = accountRefSchema.parse("fake:1:0x000000c1");
const otherHook = accountRefSchema.parse("fake:1:0x000000c2");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");

const quote: VenueQuote = {
  expectedOut: { asset: token, base: 1_000n },
  priceImpactBps: bpsSchema.parse(10),
};

const fee = (feeBps: number, hooks: readonly AccountRef[]) => ({
  maker: "Genius.fun",
  feeBps: bpsSchema.parse(feeBps),
  hooks,
});

describe("a route's pool hook fees (decision 0215)", () => {
  it("adds every maker's fee, and names each hook once", () => {
    const hooked = { ...quote, hookFees: [fee(100, [hook]), fee(50, [hook, otherHook])] };
    expect(routeHookFeeBps(hooked)).toBe(150);
    expect(routeHooksOf(hooked)).toStrictEqual([hook, otherHook]);
  });

  it("holds the fees to the whole trade at most", () => {
    const hooked = { ...quote, hookFees: [fee(8_000, [hook]), fee(5_000, [otherHook])] };
    expect(routeHookFeeBps(hooked)).toBe(10_000);
  });

  it("says nothing of a route that passes no hook", () => {
    expect([routeHookFeeBps(quote), routeHooksOf(quote)]).toStrictEqual([undefined, []]);
  });
});
