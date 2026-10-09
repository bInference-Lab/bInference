import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { aggregatorEffectOf } from "./aggregator-effect.js";
import { aggregatorPairOf } from "./aggregator-pair.js";
import { aggregatorNativeToken } from "./aggregator-token.js";

const bsc = {
  chain: chainRefSchema.parse("eip155:56"),
  nativeAsset: assetRefSchema.parse("eip155:56/slip44:714"),
};
const chains = new Map([[bsc.chain, bsc]]);
const usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
const usdt = assetRefSchema.parse(`eip155:56/erc20:${usdtAddress}`);
const walletAddress = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const wallet = accountRefSchema.parse(`eip155:56:${walletAddress}`);

describe("aggregator pairs and effects", () => {
  it("writes a trade on the wallet's chain as the aggregator's token addresses", () => {
    const trade = { wallet, amountIn: { asset: bsc.nativeAsset, base: 1n }, assetOut: usdt };
    expect(aggregatorPairOf(trade, chains)).toStrictEqual({
      on: bsc,
      tokenIn: aggregatorNativeToken,
      tokenOut: usdtAddress,
    });
  });

  it.each([
    ["a wallet on another chain", accountRefSchema.parse(`eip155:1:${walletAddress}`), usdt],
    ["an asset of another chain", wallet, assetRefSchema.parse("eip155:1/slip44:60")],
  ])("names no pair for %s", (_label, account, assetOut) => {
    const trade = { wallet: account, amountIn: { asset: bsc.nativeAsset, base: 1n }, assetOut };
    expect(aggregatorPairOf(trade, chains)).toBeUndefined();
  });

  it("reports a router call's effect in the chain's assets and milliseconds", () => {
    const call = {
      recipient: walletAddress,
      fromToken: usdtAddress,
      amount: 5n,
      toToken: aggregatorNativeToken,
      minReturn: 3n,
      deadlineSec: 1_791_483_260n,
    } as const;
    expect(aggregatorEffectOf(call, bsc)).toStrictEqual({
      recipient: wallet,
      amountIn: { asset: usdt, base: 5n },
      minOut: { asset: bsc.nativeAsset, base: 3n },
      deadlineMs: 1_791_483_260_000,
    });
    expect(aggregatorEffectOf({ ...call, deadlineSec: 2n ** 64n }, bsc)).toBeUndefined();
  });
});
