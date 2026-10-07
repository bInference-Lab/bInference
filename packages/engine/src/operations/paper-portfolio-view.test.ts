import { describe, expect, it } from "vitest";
import { testCoin, testToken, testWallet } from "../intents/test-intents.js";
import type { PositionRecord } from "../positions/position-record.js";
import { paperPortfolioViewOf } from "./paper-portfolio-view.js";
import { testChains } from "./test-engine.js";

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

describe("a paper portfolio's view", () => {
  it("shows held units as balances, values them when priced, and keeps realized P&L", () => {
    const view = paperPortfolioViewOf(
      [
        {
          position: row({ quantityBase: 5n, costUsdMicros: 3n }),
          valueUsdMicros: 4n,
          unrealizedUsdMicros: 1n,
        },
        { position: row({ asset: testToken, quantityBase: 7n, costUsdMicros: 9n }) },
        { position: row({ asset: testToken, walletId: testWallet, realizedUsdMicros: -2n }) },
        { position: row({}), valueUsdMicros: 0n, unrealizedUsdMicros: 0n },
      ],
      testChains(),
    );
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
    expect(view.totalUsdMicros).toBe(4n);
    expect(Object.keys(view.assets)).toStrictEqual([testCoin, testToken]);
  });
});
