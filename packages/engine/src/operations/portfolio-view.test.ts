import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCoin, testToken, testWallet } from "../intents/test-intents.js";
import type { PositionRecord } from "../positions/position-record.js";
import { paperHoldingsOf, portfolioViewOf, type WalletHoldings } from "./portfolio-view.js";
import { testChains } from "./test-engine.js";

const otherWallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const row = (fields: Partial<PositionRecord>): PositionRecord => ({
  walletId: testWallet,
  asset: testCoin,
  isPaper: true,
  quantityBase: 0n,
  costUsdMicros: 0n,
  realizedUsdMicros: 0n,
  changedAtMs: 1_000,
  version: 0,
  ...fields,
});

// A live wallet holding 3 units of the coin worth `usdMicros`, and nothing of the token.
const live = (walletId: typeof testWallet, usdMicros: bigint): WalletHoldings => ({
  walletId,
  isPaper: false,
  balances: [
    { amount: { asset: testCoin, base: 3n }, usdMicros },
    { amount: { asset: testToken, base: 0n } },
  ],
  positions: [],
});

describe("a portfolio's view", () => {
  it("shows a paper portfolio's held units as balances, valued when priced, with realized P&L", () => {
    const holdings = paperHoldingsOf(testWallet, [
      {
        position: row({ quantityBase: 5n, costUsdMicros: 3n }),
        valueUsdMicros: 4n,
        unrealizedUsdMicros: 1n,
      },
      { position: row({ asset: testToken, quantityBase: 7n, costUsdMicros: 9n }) },
      { position: row({ asset: testToken, realizedUsdMicros: -2n }) },
      { position: row({}), valueUsdMicros: 0n, unrealizedUsdMicros: 0n },
    ]);
    const view = portfolioViewOf([holdings], testChains());
    expect(view.balances).toStrictEqual([
      { wallet: testWallet, amount: { asset: testCoin, base: 5n }, usdMicros: 4n, paper: true },
      { wallet: testWallet, amount: { asset: testToken, base: 7n }, paper: true },
    ]);
    expect(
      view.positions.map((position) => [position.quantity, position.unrealizedUsdMicros]),
    ).toStrictEqual([
      [5n, 1n],
      [7n, undefined],
      [0n, undefined],
    ]);
    expect([view.totalUsdMicros, view.paperTotalUsdMicros]).toStrictEqual([0n, 4n]);
    expect(Object.keys(view.assets)).toStrictEqual([testCoin, testToken]);
  });

  it("shows every live holding before every paper one, and never adds the two totals", () => {
    const paper = paperHoldingsOf(testWallet, [
      { position: row({ quantityBase: 2n }), valueUsdMicros: 20n, unrealizedUsdMicros: 0n },
    ]);
    const view = portfolioViewOf(
      [paper, live(testWallet, 30n), live(otherWallet, 40n)],
      testChains(),
    );
    expect(view.balances.map(({ wallet, paper: isPaper }) => [wallet, isPaper])).toStrictEqual([
      [testWallet, false],
      [otherWallet, false],
      [testWallet, true],
    ]);
    expect([view.totalUsdMicros, view.paperTotalUsdMicros]).toStrictEqual([70n, 20n]);
    expect(portfolioViewOf([live(testWallet, 30n)], testChains())).not.toHaveProperty(
      "paperTotalUsdMicros",
    );
  });
});
