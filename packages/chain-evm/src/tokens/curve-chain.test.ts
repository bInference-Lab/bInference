import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import type { RpcFailover } from "../rpc/rpc-call.js";
import {
  type CurveChain,
  curveAssetOf,
  curveChainSetupsOf,
  curveLossBps,
  curvePairTokenOf,
  curveSideOf,
  curveTokenOf,
  curveTokenOn,
} from "./curve-chain.js";

const chain = chainRefSchema.parse("eip155:56");
const bnb = assetRefSchema.parse("eip155:56/slip44:714");
const usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
const tokenAddress = "0x7270576A906EAe19a995273695ec223056bD7777";
const usdt = assetRefSchema.parse(`eip155:56/erc20:${usdtAddress}`);
const token = assetRefSchema.parse(`eip155:56/erc20:${tokenAddress}`);
const zero = "0x0000000000000000000000000000000000000000";
const rpc: RpcFailover = {
  request: async () => await Promise.reject(new Error("no node here")),
  health: () => [],
};
const venue = { id: "pad", name: "Pad" };
const item: CurveChain = { chain, nativeAsset: bnb, quoteTokens: [usdt], rpc };

// The setup of the one chain; a test that expects it fails without it.
function setup() {
  const on = curveChainSetupsOf([item], venue).get(chain);
  if (on === undefined) {
    throw new Error("The chain has no setup.");
  }
  return on;
}

describe("a launchpad's curve chains", () => {
  it("keys each chain's setup by chain, with its quote tokens by address", () => {
    expect(setup().quoteTokens).toStrictEqual(new Map([[usdtAddress, usdt]]));
  });

  it.each<[string, readonly CurveChain[]]>([
    ["no chain", []],
    ["a chain twice", [item, item]],
    ["a native asset of another kind", [{ ...item, nativeAsset: usdt }]],
    ["a quote token that is the coin", [{ ...item, quoteTokens: [bnb] }]],
    ["a quote token twice", [{ ...item, quoteTokens: [usdt, usdt] }]],
  ])("refuses %s as the venue's bad options", (_case, chains) => {
    expect(() => curveChainSetupsOf(chains, venue)).toThrow(
      expect.objectContaining({ code: "pad.bad_options" }),
    );
  });

  it("writes the coin as the zero address and a token by its address, and reads both back", () => {
    const on = { chain, nativeAsset: bnb };
    expect([curveTokenOf(bnb, on), curveTokenOf(token, on)]).toStrictEqual([zero, tokenAddress]);
    expect([curveAssetOf(zero, on), curveAssetOf(tokenAddress, on)]).toStrictEqual([bnb, token]);
    expect(curveTokenOf(assetRefSchema.parse(`eip155:1/erc20:${tokenAddress}`), on)).toBe(
      undefined,
    );
  });

  it("names the coin and a listed quote token as pairs, and no other token", () => {
    const on = setup();
    expect([curvePairTokenOf(bnb, on), curvePairTokenOf(usdt, on)]).toStrictEqual([
      zero,
      usdtAddress,
    ]);
    expect(curvePairTokenOf(token, on)).toBeUndefined();
  });

  it("reads a buy, a sale, and no curve trade between two quote assets or two tokens", () => {
    const on = setup();
    const amount = (asset: typeof bnb) => ({ asset, base: 1n });
    expect(curveSideOf({ amountIn: amount(usdt), assetOut: token }, on)).toStrictEqual({
      side: "buy",
      token: tokenAddress,
      quote: usdtAddress,
      inputToken: usdtAddress,
      outputToken: tokenAddress,
    });
    expect(curveSideOf({ amountIn: amount(token), assetOut: bnb }, on)).toMatchObject({
      side: "sell",
      token: tokenAddress,
      quote: zero,
    });
    expect(curveSideOf({ amountIn: amount(bnb), assetOut: usdt }, on)).toBeUndefined();
    expect(curveSideOf({ amountIn: amount(token), assetOut: token }, on)).toBeUndefined();
  });

  it("finds a token's chain setup and address, and none for the coin or another chain's token", () => {
    const setups = curveChainSetupsOf([item], venue);
    expect(curveTokenOn(token, setups)).toStrictEqual({ setup: setup(), token: tokenAddress });
    expect(curveTokenOn(bnb, setups)).toBeUndefined();
    expect(curveTokenOn(assetRefSchema.parse(`eip155:1/erc20:${tokenAddress}`), setups)).toBe(
      undefined,
    );
  });

  it.each([
    { name: "a loss", lost: 1n, value: 10_001n, bps: 1 },
    { name: "no loss", lost: 0n, value: 10_000n, bps: 0 },
    { name: "a gain", lost: -5n, value: 10_000n, bps: 0 },
    { name: "a loss of the whole value or more", lost: 20_000n, value: 10_000n, bps: 10_000 },
    { name: "no value", lost: 1n, value: 0n, bps: 10_000 },
  ])("reads $name as its share of the value, rounded up", ({ lost, value, bps }) => {
    expect(curveLossBps(lost, value)).toBe(bps);
  });
});
