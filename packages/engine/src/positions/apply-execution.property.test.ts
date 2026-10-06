import { type AssetRef, assetRefSchema } from "@binference/chain";
import { mulDiv, type Ratio } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { applyExecution } from "./apply-execution.js";
import type { ExecutionDraft } from "./execution-record.js";
import type { PositionRecord, PositionWrite } from "./position-record.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const assets: readonly AssetRef[] = [
  coin,
  assetRefSchema.parse("fake:1/token:a"),
  assetRefSchema.parse("fake:1/token:b"),
];
const walletId = fixtureId("wal", 1);
const bpsWhole = 10_000n;

// One trade, as shares of what the wallet holds when it runs. Shares above 10,000 basis points
// sell more than the positions hold, as a wallet funded from outside does.
interface Spec {
  readonly soldAt: number;
  readonly boughtStep: number;
  readonly soldBps: bigint;
  readonly feeBps: bigint;
  readonly gasBps: bigint;
  readonly boughtBase: bigint;
  readonly valueUsdMicros: bigint;
  readonly feeUsdMicros: bigint;
  readonly gasUsdMicros: bigint;
}

const usd = fc.bigInt({ min: 0n, max: 10n ** 12n });
const specs = (maxBps: bigint): fc.Arbitrary<readonly Spec[]> =>
  fc.array(
    fc.record({
      soldAt: fc.integer({ min: 0, max: 2 }),
      boughtStep: fc.integer({ min: 1, max: 2 }),
      soldBps: fc.bigInt({ min: 0n, max: maxBps }),
      feeBps: fc.bigInt({ min: 0n, max: maxBps }),
      gasBps: fc.bigInt({ min: 0n, max: maxBps }),
      boughtBase: fc.bigInt({ min: 0n, max: 10n ** 24n }),
      valueUsdMicros: usd,
      feeUsdMicros: usd,
      gasUsdMicros: usd,
    }),
    { maxLength: 30 },
  );

interface Opening {
  readonly quantityBase: bigint;
  readonly costUsdMicros: bigint;
}

function openingBook(rows: readonly Opening[]): readonly PositionRecord[] {
  return rows.map((row, index) => ({
    walletId,
    asset: assets[index] ?? coin,
    isPaper: false,
    quantityBase: row.quantityBase,
    costUsdMicros: row.costUsdMicros,
    realizedUsdMicros: 0n,
    changedAtMs: 0,
    version: 0,
  }));
}

const openings: fc.Arbitrary<readonly PositionRecord[]> = fc
  .array(fc.record({ quantityBase: fc.bigInt({ min: 1n, max: 10n ** 24n }), costUsdMicros: usd }), {
    minLength: assets.length,
    maxLength: assets.length,
  })
  .map(openingBook);

const prices: fc.Arbitrary<readonly Ratio[]> = fc.tuple(
  ...assets.map(() =>
    fc.record({
      numerator: fc.bigInt({ min: 0n, max: 10n ** 9n }),
      denominator: fc.bigInt({ min: 1n, max: 10n ** 18n }),
    }),
  ),
);

const heldOf = (book: ReadonlyMap<AssetRef, PositionRecord>, asset: AssetRef): bigint =>
  book.get(asset)?.quantityBase ?? 0n;

// The trade a spec describes, or none when it would sell nothing.
function executionOf(
  book: ReadonlyMap<AssetRef, PositionRecord>,
  spec: Spec,
  atMs: number,
): ExecutionDraft | undefined {
  const sold = assets[spec.soldAt] ?? coin;
  const bought = assets[(spec.soldAt + spec.boughtStep) % assets.length] ?? coin;
  const soldBase = (heldOf(book, sold) * spec.soldBps) / bpsWhole;
  if (soldBase === 0n) {
    return undefined;
  }
  const feeBase = (heldOf(book, sold) * spec.feeBps) / bpsWhole / 100n;
  const gasBase = (heldOf(book, coin) * spec.gasBps) / bpsWhole / 100n;
  return {
    intentId: fixtureId("int", atMs + 1),
    walletId,
    isPaper: false,
    atMs,
    sold: { asset: sold, base: soldBase },
    feeBase,
    bought: { asset: bought, base: spec.boughtBase },
    gas: { asset: coin, base: gasBase },
    valueUsdMicros: spec.valueUsdMicros,
    feeUsdMicros: feeBase === 0n ? 0n : spec.feeUsdMicros,
    gasUsdMicros: gasBase === 0n ? 0n : spec.gasUsdMicros,
  };
}

// Stores each write as the position store does, after checking it read the stored version.
function store(
  book: ReadonlyMap<AssetRef, PositionRecord>,
  writes: readonly PositionWrite[],
): ReadonlyMap<AssetRef, PositionRecord> {
  const next = new Map(book);
  for (const { position, readVersion } of writes) {
    expect(readVersion).toBe(book.get(position.asset)?.version);
    next.set(position.asset, { ...position, version: (readVersion ?? -1) + 1 });
  }
  return next;
}

// Realized less cost over every position: P&L moves from one position to the next and is never
// made; only units sold beyond what the positions hold take it down.
const netOf = (book: ReadonlyMap<AssetRef, PositionRecord>): bigint =>
  [...book.values()].reduce(
    (sum, position) => sum + position.realizedUsdMicros - position.costUsdMicros,
    0n,
  );

function run(
  opening: readonly PositionRecord[],
  all: readonly Spec[],
): readonly ReadonlyMap<AssetRef, PositionRecord>[] {
  const books: ReadonlyMap<AssetRef, PositionRecord>[] = [
    new Map(opening.map((position) => [position.asset, position])),
  ];
  for (const [index, spec] of all.entries()) {
    const book = books.at(-1) ?? new Map();
    const execution = executionOf(book, spec, index + 1);
    books.push(
      execution === undefined ? book : store(book, applyExecution([...book.values()], execution)),
    );
  }
  return books;
}

const isBroken = (position: PositionRecord): boolean =>
  position.quantityBase < 0n ||
  position.costUsdMicros < 0n ||
  (position.quantityBase === 0n && position.costUsdMicros !== 0n);

function pnlAt(book: ReadonlyMap<AssetRef, PositionRecord>, now: readonly Ratio[]): bigint {
  return assets.reduce((sum, asset, index) => {
    const position = book.get(asset);
    const value = mulDiv(
      position?.quantityBase ?? 0n,
      now[index] ?? { numerator: 0n, denominator: 1n },
      "down",
    );
    return sum + (position?.realizedUsdMicros ?? 0n) + value - (position?.costUsdMicros ?? 0n);
  }, 0n);
}

function valueAt(book: ReadonlyMap<AssetRef, PositionRecord>, now: readonly Ratio[]): bigint {
  return assets.reduce(
    (sum, asset, index) =>
      sum + mulDiv(heldOf(book, asset), now[index] ?? { numerator: 0n, denominator: 1n }, "down"),
    0n,
  );
}

function positionsOf(
  books: readonly ReadonlyMap<AssetRef, PositionRecord>[],
): readonly PositionRecord[] {
  const positions: PositionRecord[] = [];
  for (const book of books) {
    positions.push(...book.values());
  }
  return positions;
}

// The steps at which realized less cost rose.
function rises(nets: readonly bigint[]): readonly number[] {
  return nets.flatMap((net, index) => (index > 0 && net > (nets[index - 1] ?? net) ? [index] : []));
}

function lastOf(
  books: readonly ReadonlyMap<AssetRef, PositionRecord>[],
): ReadonlyMap<AssetRef, PositionRecord> {
  return books.at(-1) ?? new Map();
}

describe("applyExecution properties", () => {
  it("never leaves a position below zero, or costing something while it holds nothing", () => {
    fc.assert(
      fc.property(openings, specs(20_000n), (opening, all) => {
        expect(positionsOf(run(opening, all)).filter(isBroken)).toStrictEqual([]);
      }),
    );
  });

  it("never makes P&L: realized less cost only falls, by what came from outside", () => {
    fc.assert(
      fc.property(openings, specs(20_000n), (opening, all) => {
        expect(rises(run(opening, all).map(netOf))).toStrictEqual([]);
      }),
    );
  });

  it("makes realized plus unrealized equal value less the opening cost when sales stay covered", () => {
    fc.assert(
      fc.property(openings, specs(4_999n), prices, (opening, all, now) => {
        const last = lastOf(run(opening, all));
        const openingCost = opening.reduce((sum, position) => sum + position.costUsdMicros, 0n);
        expect(pnlAt(last, now)).toBe(valueAt(last, now) - openingCost);
      }),
    );
  });
});
