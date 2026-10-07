import { type AssetRef, assetRefSchema } from "@binference/chain";
import { mulDiv, type Ratio } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { applyArrival } from "./apply-arrival.js";
import { applyExecution } from "./apply-execution.js";
import type { ArrivalDraft } from "./arrival-record.js";
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
const usd = fc.bigInt({ min: 0n, max: 10n ** 12n });

// Funds that arrive without a trade; `valueUsdMicros` is absent when no price was known.
interface ArrivalStep {
  readonly kind: "arrival";
  readonly assetAt: number;
  readonly base: bigint;
  readonly valueUsdMicros?: bigint;
}

// A trade, as shares of what the wallet holds: at most 98% sold, 1% fee and 1% gas, so the wallet
// always holds what a trade takes.
interface TradeStep {
  readonly kind: "trade";
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

type Step = ArrivalStep | TradeStep;

const arrivalShape = {
  kind: fc.constant("arrival"),
  assetAt: fc.integer({ min: 0, max: assets.length - 1 }),
  base: fc.bigInt({ min: 1n, max: 10n ** 24n }),
} as const;
const pricedArrivals: fc.Arbitrary<ArrivalStep> = fc.record({
  ...arrivalShape,
  valueUsdMicros: fc.bigInt({ min: 1n, max: 10n ** 12n }),
});
const anyArrivals: fc.Arbitrary<ArrivalStep> = fc.oneof(pricedArrivals, fc.record(arrivalShape));

const tradeSteps: fc.Arbitrary<TradeStep> = fc.record({
  kind: fc.constant("trade"),
  soldAt: fc.integer({ min: 0, max: 2 }),
  boughtStep: fc.integer({ min: 1, max: 2 }),
  soldBps: fc.bigInt({ min: 0n, max: 9_800n }),
  feeBps: fc.bigInt({ min: 0n, max: bpsWhole }),
  gasBps: fc.bigInt({ min: 0n, max: bpsWhole }),
  boughtBase: fc.bigInt({ min: 0n, max: 10n ** 24n }),
  valueUsdMicros: usd,
  feeUsdMicros: usd,
  gasUsdMicros: usd,
});

const stepLists = (arrivals: fc.Arbitrary<ArrivalStep>): fc.Arbitrary<readonly Step[]> =>
  fc.array(fc.oneof(arrivals, tradeSteps), { maxLength: 30 });

const prices: fc.Arbitrary<readonly Ratio[]> = fc.tuple(
  ...assets.map(() =>
    fc.record({
      numerator: fc.bigInt({ min: 0n, max: 10n ** 9n }),
      denominator: fc.bigInt({ min: 1n, max: 10n ** 18n }),
    }),
  ),
);

// The positions after a step, the units in the wallet, and what the priced arrivals were worth.
interface State {
  readonly book: ReadonlyMap<AssetRef, PositionRecord>;
  readonly wallet: ReadonlyMap<AssetRef, bigint>;
  readonly arrivedUsdMicros: bigint;
}

const unitsOf = (wallet: ReadonlyMap<AssetRef, bigint>, asset: AssetRef): bigint =>
  wallet.get(asset) ?? 0n;

function moved(
  wallet: ReadonlyMap<AssetRef, bigint>,
  changes: readonly (readonly [AssetRef, bigint])[],
): ReadonlyMap<AssetRef, bigint> {
  const next = new Map(wallet);
  for (const [asset, units] of changes) {
    next.set(asset, unitsOf(next, asset) + units);
  }
  return next;
}

// Stores each write as the position store does, after checking it read the stored version.
function stored(
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

function arrive(state: State, step: ArrivalStep, atMs: number): State {
  const asset = assets[step.assetAt] ?? coin;
  const arrival: ArrivalDraft = {
    walletId,
    isPaper: false,
    atMs,
    received: { asset, base: step.base },
    ...(step.valueUsdMicros === undefined ? {} : { valueUsdMicros: step.valueUsdMicros }),
  };
  return {
    book: stored(state.book, applyArrival([...state.book.values()], arrival)),
    wallet: moved(state.wallet, [[asset, step.base]]),
    arrivedUsdMicros: state.arrivedUsdMicros + (step.valueUsdMicros ?? 0n),
  };
}

function trade(state: State, step: TradeStep, atMs: number): State {
  const sold = assets[step.soldAt] ?? coin;
  const bought = assets[(step.soldAt + step.boughtStep) % assets.length] ?? coin;
  const soldBase = (unitsOf(state.wallet, sold) * step.soldBps) / bpsWhole;
  if (soldBase === 0n) {
    return state;
  }
  const feeBase = (unitsOf(state.wallet, sold) * step.feeBps) / bpsWhole / 100n;
  const gasBase = (unitsOf(state.wallet, coin) * step.gasBps) / bpsWhole / 100n;
  const execution: ExecutionDraft = {
    intentId: fixtureId("int", atMs),
    walletId,
    isPaper: false,
    atMs,
    sold: { asset: sold, base: soldBase },
    feeBase,
    bought: { asset: bought, base: step.boughtBase },
    gas: { asset: coin, base: gasBase },
    valueUsdMicros: step.valueUsdMicros,
    feeUsdMicros: feeBase === 0n ? 0n : step.feeUsdMicros,
    gasUsdMicros: gasBase === 0n ? 0n : step.gasUsdMicros,
  };
  return {
    ...state,
    book: stored(state.book, applyExecution([...state.book.values()], execution)),
    wallet: moved(state.wallet, [
      [sold, -(soldBase + feeBase)],
      [coin, -gasBase],
      [bought, step.boughtBase],
    ]),
  };
}

const empty: State = { book: new Map(), wallet: new Map(), arrivedUsdMicros: 0n };

const lastOf = (states: readonly State[]): State => states.at(-1) ?? empty;

function run(steps: readonly Step[]): readonly State[] {
  return steps.reduce<readonly State[]>(
    (states, step, index) => [
      ...states,
      step.kind === "arrival"
        ? arrive(lastOf(states), step, index + 1)
        : trade(lastOf(states), step, index + 1),
    ],
    [empty],
  );
}

// Realized less cost over every position, plus what priced arrivals brought: P&L that was made.
const madeOf = (state: State): bigint =>
  [...state.book.values()].reduce(
    (sum, position) => sum + position.realizedUsdMicros - position.costUsdMicros,
    state.arrivedUsdMicros,
  );

const heldOf = (state: State, asset: AssetRef): bigint => state.book.get(asset)?.quantityBase ?? 0n;

function pnlAt(state: State, now: readonly Ratio[]): bigint {
  return assets.reduce((sum, asset, index) => {
    const position = state.book.get(asset);
    const value = mulDiv(
      heldOf(state, asset),
      now[index] ?? { numerator: 0n, denominator: 1n },
      "down",
    );
    return sum + (position?.realizedUsdMicros ?? 0n) + value - (position?.costUsdMicros ?? 0n);
  }, 0n);
}

function valueAt(state: State, now: readonly Ratio[]): bigint {
  return assets.reduce(
    (sum, asset, index) =>
      sum +
      mulDiv(
        unitsOf(state.wallet, asset),
        now[index] ?? { numerator: 0n, denominator: 1n },
        "down",
      ),
    0n,
  );
}

// The steps at which the P&L made rose.
function rises(made: readonly bigint[]): readonly number[] {
  return made.flatMap((net, index) => (index > 0 && net > (made[index - 1] ?? net) ? [index] : []));
}

const isBroken = (position: PositionRecord): boolean =>
  position.quantityBase < 0n ||
  position.costUsdMicros < 0n ||
  (position.quantityBase === 0n && position.costUsdMicros !== 0n);

describe("applyArrival properties", () => {
  it("opens every priced arrival: positions hold what the wallet holds, unit for unit", () => {
    fc.assert(
      fc.property(stepLists(pricedArrivals), (steps) => {
        for (const state of run(steps)) {
          expect(assets.map((asset) => heldOf(state, asset))).toStrictEqual(
            assets.map((asset) => unitsOf(state.wallet, asset)),
          );
        }
      }),
    );
  });

  it("makes realized plus unrealized equal the wallet's value less what arrived", () => {
    fc.assert(
      fc.property(stepLists(pricedArrivals), prices, (steps, now) => {
        const states = run(steps);
        expect(states.map(madeOf)).toStrictEqual(states.map(() => 0n));
        const last = lastOf(states);
        expect(pnlAt(last, now)).toBe(valueAt(last, now) - last.arrivedUsdMicros);
      }),
    );
  });

  it("keeps unpriced arrivals out: no position above the wallet, below zero, or making P&L", () => {
    fc.assert(
      fc.property(stepLists(anyArrivals), (steps) => {
        const states = run(steps);
        expect(rises(states.map(madeOf))).toStrictEqual([]);
        for (const state of states) {
          expect([...state.book.values()].filter(isBroken)).toStrictEqual([]);
          expect(
            assets.filter((asset) => heldOf(state, asset) > unitsOf(state.wallet, asset)),
          ).toStrictEqual([]);
        }
      }),
    );
  });
});
