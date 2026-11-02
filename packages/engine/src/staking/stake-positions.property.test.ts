import { assetRefSchema } from "@binference/chain";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { applyUnbondingSale } from "../positions/apply-execution.js";
import type { PositionRecord, PositionWrite } from "../positions/position-record.js";
import { claimArrivalsOf } from "./book-stake.js";
import type { UnbondingRecord } from "./unbonding-record.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");
const walletId = fixtureId("wal", 1);
const intentId = fixtureId("int", 1);
const usd = fc.bigInt({ min: 0n, max: 10n ** 12n });
const units = fc.bigInt({ min: 1n, max: 10n ** 24n });

// Receipt units held at a cost, and an unstake that sells at most all of them at a coin value.
interface Unstake {
  readonly quantity: bigint;
  readonly cost: bigint;
  readonly sold: bigint;
  readonly value: bigint;
}

const unstakes: fc.Arbitrary<Unstake> = fc
  .record({ quantity: units, cost: usd, sold: units, value: usd })
  .map(({ quantity, cost, sold, value }) => ({
    quantity,
    cost,
    sold: sold > quantity ? quantity : sold,
    value,
  }));

function heldOf(spec: Unstake): PositionRecord {
  return {
    walletId,
    asset: receipt,
    isPaper: false,
    quantityBase: spec.quantity,
    costUsdMicros: spec.cost,
    realizedUsdMicros: 0n,
    changedAtMs: 0,
    version: 3,
  };
}

// The unstake as an execution: receipt units out at the coin's value then, no fee or gas.
function unstakeOf(spec: Unstake) {
  return {
    intentId,
    walletId,
    isPaper: false,
    atMs: 5_000,
    sold: { asset: receipt, base: spec.sold },
    feeBase: 0n,
    bought: { asset: coin, base: spec.sold },
    gas: { asset: coin, base: 0n },
    valueUsdMicros: spec.value,
    feeUsdMicros: 0n,
    gasUsdMicros: 0n,
  };
}

// What one sale did to the receipt position, as cost out, units, gain and cost left.
function saleOf(spec: Unstake, writes: readonly PositionWrite[]) {
  const [write, ...more] = writes;
  if (write === undefined || more.length > 0) {
    throw new Error("Expected one position write.");
  }
  const { asset, quantityBase, costUsdMicros, realizedUsdMicros } = write.position;
  return { asset, quantityBase, costOut: spec.cost - costUsdMicros, realizedUsdMicros };
}

function rowOf(index: number, base: bigint, valueUsdMicros: bigint | undefined): UnbondingRecord {
  return {
    id: index + 1,
    intentId,
    walletId,
    venue: "fake-staking",
    requestRef: `r:${String(index)}`,
    amount: { asset: coin, base },
    ...(valueUsdMicros === undefined ? {} : { valueUsdMicros }),
    readyAtMs: 1_000,
    isPaper: false,
  };
}

const rows: fc.Arbitrary<readonly UnbondingRecord[]> = fc
  .array(fc.tuple(units, fc.option(usd, { nil: undefined })), { maxLength: 6 })
  .map((all: readonly (readonly [bigint, bigint | undefined])[]) =>
    all.map(([base, value], index) => rowOf(index, base, value)),
  );

const valuedBaseOf = (taken: readonly UnbondingRecord[]): bigint =>
  taken.reduce((sum, row) => sum + (row.valueUsdMicros === undefined ? 0n : row.amount.base), 0n);

// A claim of the rows that took out all their coin and `extra` less one more, as booked.
function claimOf(taken: readonly UnbondingRecord[], extra: bigint) {
  const moved = { asset: coin, base: valuedBaseOf(taken) + extra - 1n };
  const record = { id: intentId, walletId, isPaper: false };
  const arrivals = claimArrivalsOf(taken, { record, moved, atMs: 9_000 });
  const valued = arrivals.filter((arrival) => arrival.valueUsdMicros !== undefined);
  return {
    moved: moved.base,
    received: arrivals.reduce((sum, arrival) => sum + arrival.received.base, 0n),
    valued: valued.length,
    value: valued.reduce((sum, arrival) => sum + (arrival.valueUsdMicros ?? 0n), 0n),
  };
}

// What the rows recorded, which a claim books when any row holds a value.
const recordedOf = (taken: readonly UnbondingRecord[]): bigint =>
  valuedBaseOf(taken) === 0n
    ? 0n
    : taken.reduce((sum, row) => sum + (row.valueUsdMicros ?? 0n), 0n);

describe("the positions of staking moves (decision 0327)", () => {
  it("sells an unstake's receipt units at average cost, adds no coin, and moves each dollar once", () => {
    fc.assert(
      fc.property(unstakes, (spec) => {
        const sale = saleOf(spec, applyUnbondingSale([heldOf(spec)], unstakeOf(spec)));
        expect(sale.asset).toBe(receipt);
        expect(sale.quantityBase).toBe(spec.quantity - spec.sold);
        expect(sale.costOut).toBeGreaterThanOrEqual(0n);
        expect(sale.costOut).toBeLessThanOrEqual(spec.cost);
        expect(sale.realizedUsdMicros).toBe(spec.value - sale.costOut);
      }),
    );
  });

  it("takes the whole cost out with the last receipt unit", () => {
    fc.assert(
      fc.property(unstakes, (spec) => {
        const whole = { ...spec, sold: spec.quantity };
        const sale = saleOf(whole, applyUnbondingSale([heldOf(whole)], unstakeOf(whole)));
        expect(sale.costOut).toBe(spec.cost);
      }),
    );
  });

  it("books a claim's coin once in all, valued at what its unstakes recorded and no more", () => {
    fc.assert(
      fc.property(rows, units, (taken: readonly UnbondingRecord[], extra) => {
        const claim = claimOf(taken, extra);
        expect(claim.received).toBe(claim.moved);
        expect(claim.valued <= 1).toBe(true);
        expect(claim.value).toBe(recordedOf(taken));
      }),
    );
  });
});
