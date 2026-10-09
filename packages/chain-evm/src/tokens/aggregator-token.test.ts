import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { aggregatorAssetOf, aggregatorNativeToken, aggregatorTokenOf } from "./aggregator-token.js";

const bsc = {
  chain: chainRefSchema.parse("eip155:56"),
  nativeAsset: assetRefSchema.parse("eip155:56/slip44:714"),
};
const usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
const usdt = assetRefSchema.parse(`eip155:56/erc20:${usdtAddress}`);

describe("aggregator token addresses", () => {
  it("writes the chain's coin as the aggregators' placeholder address", () => {
    expect(aggregatorTokenOf(bsc.nativeAsset, bsc)).toBe(aggregatorNativeToken);
    expect(aggregatorAssetOf(aggregatorNativeToken, bsc)).toBe(bsc.nativeAsset);
  });

  it("writes a token on the chain as its checksum address, and reads it back", () => {
    const lower = assetRefSchema.parse(`eip155:56/erc20:${usdtAddress.toLowerCase()}`);
    expect(aggregatorTokenOf(lower, bsc)).toBe(usdtAddress);
    expect(aggregatorAssetOf(usdtAddress, bsc)).toBe(usdt);
  });

  it.each([
    ["a token of another chain", `eip155:1/erc20:${usdtAddress}`],
    ["another chain's coin", "eip155:1/slip44:60"],
    ["the placeholder written as a token", `eip155:56/erc20:${aggregatorNativeToken}`],
    ["a token whose address is not one", "eip155:56/erc20:0x55d3"],
  ])("names no address for %s", (_label, asset) => {
    expect(aggregatorTokenOf(assetRefSchema.parse(asset), bsc)).toBeUndefined();
  });
});
