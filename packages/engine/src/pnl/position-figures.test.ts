import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { ArrivalRecord } from "../positions/arrival-record.js";
import type { ValuedPosition } from "../positions/create-positions.js";
import type { ExecutionRecord } from "../positions/execution-record.js";
import { addFigures, positionFigures } from "./position-figures.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const stable = assetRefSchema.parse("fake:1/token:b");
const walletId = fixtureId("wal", 1);
const one = 10n ** 18n;

const held: ValuedPosition = {
  position: {
    walletId,
    asset: token,
    isPaper: true,
    quantityBase: 3n * one,
    costUsdMicros: 30_000_000n,
    realizedUsdMicros: 5_000_000n,
    changedAtMs: 900,
    version: 4,
  },
  valueUsdMicros: 36_000_000n,
  unrealizedUsdMicros: 6_000_000n,
};

function execution(id: number, fields: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id,
    intentId: fixtureId("int", id),
    walletId,
    isPaper: true,
    atMs: 100 * id,
    sold: { asset: coin, base: one },
    feeBase: 1n,
    bought: { asset: token, base: one },
    gas: { asset: coin, base: 1n },
    valueUsdMicros: 10_000_000n,
    feeUsdMicros: 100_000n,
    gasUsdMicros: 20_000n,
    realizedUsdMicros: 0n,
    ...fields,
  };
}

function arrival(id: number, fields: Partial<ArrivalRecord>): ArrivalRecord {
  return {
    id,
    walletId,
    isPaper: true,
    atMs: 100 * id,
    received: { asset: token, base: one },
    valueUsdMicros: 9_000_000n,
    ...fields,
  };
}

describe("a position's figures", () => {
  it("counts the span's buys, sales and valued arrivals of its asset, and nothing before it", () => {
    const executions = [
      execution(1, {}),
      execution(3, {}),
      execution(4, { sold: { asset: token, base: one }, bought: { asset: stable, base: one } }),
      execution(5, { sold: { asset: coin, base: one }, bought: { asset: stable, base: one } }),
    ];
    const { valueUsdMicros: _unpriced, ...unvalued } = arrival(7, {});
    const arrivals = [arrival(2, {}), unvalued];
    const figures = positionFigures(held, { executions, arrivals, sinceMs: 200 });
    expect(figures).toStrictEqual({
      asset: token,
      isPaper: true,
      quantityBase: 3n * one,
      costUsdMicros: 30_000_000n,
      valueUsdMicros: 36_000_000n,
      // The row's 5.00 less the sale's fee 0.10 and gas 0.02.
      realizedUsdMicros: 4_880_000n,
      // The buy at 300 (10.00 + 0.10 + 0.02) and the arrival at 200 (9.00).
      boughtUsdMicros: 19_120_000n,
      // The sale's value less its gas.
      soldUsdMicros: 9_980_000n,
      venueFeeUsdMicros: 200_000n,
      networkFeeUsdMicros: 40_000n,
      sales: 1,
      openedAtMs: 200,
      changedAtMs: 900,
    });
  });

  it("has no opening time and no value when the ledger and the price say nothing", () => {
    const { valueUsdMicros: _value, ...unpriced } = held;
    const figures = positionFigures(unpriced, { executions: [], arrivals: [], sinceMs: 0 });
    expect(figures).not.toHaveProperty("openedAtMs");
    expect(figures).not.toHaveProperty("valueUsdMicros");
    expect(figures.realizedUsdMicros).toBe(5_000_000n);
  });

  it("adds two wallets' positions, with no value when one of them has no price", () => {
    const ledger = { executions: [execution(1, {})], arrivals: [], sinceMs: 0 };
    const first = positionFigures(held, ledger);
    const second = { ...first, openedAtMs: 50, changedAtMs: 950 };
    const { valueUsdMicros: _value, ...unpriced } = first;
    expect(addFigures(first, second)).toStrictEqual({
      ...first,
      quantityBase: 6n * one,
      costUsdMicros: 60_000_000n,
      valueUsdMicros: 72_000_000n,
      realizedUsdMicros: 10_000_000n,
      boughtUsdMicros: 20_240_000n,
      soldUsdMicros: 0n,
      venueFeeUsdMicros: 200_000n,
      networkFeeUsdMicros: 40_000n,
      sales: 0,
      openedAtMs: 50,
      changedAtMs: 950,
    });
    expect(addFigures(unpriced, second)).not.toHaveProperty("valueUsdMicros");
  });
});
