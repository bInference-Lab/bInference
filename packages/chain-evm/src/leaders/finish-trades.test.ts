import { assetRefSchema, isTxHash, type TxHash } from "@binference/chain";
import { type Address, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { erc20AssetRef, type EvmChain } from "../evm-chain.js";
import { finishTrades, shareOf } from "./finish-trades.js";
import type { TradeDraft } from "./match-trades.js";

const chain: EvmChain = {
  ref: "eip155:56" as EvmChain["ref"],
  chainId: 56,
  name: "Test chain",
  nativeAsset: assetRefSchema.parse("eip155:56/slip44:714"),
  nativeSymbol: "BNB",
  nativeDecimals: 18,
};
const wallet = getAddress("0x1a00000000000000000000000000000000000001");
const token: Address = getAddress("0x2b00000000000000000000000000000000000001");
const hash = `0x${"ab".repeat(32)}`;
const txHash: TxHash = isTxHash(hash)
  ? hash
  : (() => {
      throw new Error("Not a hash.");
    })();
const header = {
  number: 9n,
  hash: `0x${"cd".repeat(32)}` as const,
  parentHash: `0x${"ef".repeat(32)}` as const,
  timestampMs: 9_000,
};

const sale: TradeDraft = {
  account: wallet,
  txHash,
  logIndex: 4,
  side: "sell",
  asset: erc20AssetRef(chain, token),
  amount: 300n,
  counterAsset: chain.nativeAsset,
  counterAmount: 2n * 10n ** 18n,
  soldToken: token,
};

describe("finished trades", () => {
  it("takes a sale's share of the holding right before it, counting the block's earlier transfers", () => {
    const transfers = [
      { account: wallet, block: 9n, txHash, logIndex: 1, token, delta: 100n },
      { account: wallet, block: 9n, txHash, logIndex: 4, token, delta: -300n },
    ];
    const prior = {
      holding: () => 500n,
      // $600 for 10^18 base units of the coin.
      prices: new Map([[chain.nativeAsset, { numerator: 600n, denominator: 10n ** 12n }]]),
    };
    const [trade] = finishTrades(chain, { header, transfers, drafts: [sale] }, prior);
    expect(trade).toStrictEqual({
      account: `eip155:56:${wallet}`,
      txHash,
      logIndex: 4,
      side: "sell",
      asset: erc20AssetRef(chain, token),
      amount: 300n,
      counterAsset: chain.nativeAsset,
      counterAmount: 2n * 10n ** 18n,
      block: 9n,
      blockHash: header.hash,
      atMs: 9_000,
      shareSoldBps: 5_000,
      valueUsdMicros: 1_200_000_000n,
    });
  });

  it("rounds a share down and holds it at the whole", () => {
    expect([shareOf(1n, 3n), shareOf(5n, 4n), shareOf(1n, 0n), shareOf(0n, 9n)]).toStrictEqual([
      3_333, 10_000, 10_000, 0,
    ]);
  });
});
