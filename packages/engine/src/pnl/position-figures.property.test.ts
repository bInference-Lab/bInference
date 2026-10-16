import { assetRefSchema, type UsdPrice } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CardValue } from "../confirmations/card-line.js";
import { fixtureId, inOrder, live } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { createPositions } from "../positions/create-positions.js";
import type { ExecutedTrade } from "../positions/value-execution.js";
import { drawPnlCard } from "./draw-pnl-card.js";
import { type PositionFigures, positionFigures } from "./position-figures.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const stable = assetRefSchema.parse("fake:1/token:b");
const walletId = fixtureId("wal", 1);
const tokenInfo = { symbol: "TKN", name: "Token", decimals: 18, verified: true };

interface Leg {
  readonly units: bigint;
  readonly feeBase: bigint;
  readonly gasBase: bigint;
  readonly price: UsdPrice;
}

const prices: fc.Arbitrary<UsdPrice> = fc.record({
  numerator: fc.bigInt({ min: 1n, max: 10n ** 9n }),
  denominator: fc.bigInt({ min: 1n, max: 10n ** 18n }),
});

const legs: fc.Arbitrary<readonly Leg[]> = fc.array(
  fc.record({
    units: fc.bigInt({ min: 10n ** 6n, max: 10n ** 24n }),
    feeBase: fc.bigInt({ min: 0n, max: 10n ** 16n }),
    gasBase: fc.bigInt({ min: 0n, max: 10n ** 15n }),
    price: prices,
  }),
  { minLength: 1, maxLength: 5 },
);

function trade(n: number, fields: Partial<ExecutedTrade>): ExecutedTrade {
  return {
    intentId: fixtureId("int", n),
    walletId,
    isPaper: false,
    atMs: n,
    sold: { asset: coin, base: 1n },
    feeBase: 0n,
    bought: { asset: token, base: 1n },
    gas: { asset: coin, base: 0n },
    soldPrice: { numerator: 1n, denominator: 1n },
    gasPrice: { numerator: 1n, denominator: 1n },
    ...fields,
  };
}

// Buys of the token with the coin, then sales of every unit bought, fee included, for the
// stablecoin: equal shares, the last one taking what is left.
function roundTrip(buys: readonly Leg[], sales: readonly Leg[]): readonly ExecutedTrade[] {
  const bought = buys.map((leg, index) =>
    trade(index + 1, {
      sold: { asset: coin, base: leg.units },
      feeBase: leg.feeBase,
      bought: { asset: token, base: leg.units },
      gas: { asset: coin, base: leg.gasBase },
      soldPrice: leg.price,
      gasPrice: leg.price,
    }),
  );
  const total = buys.reduce((sum, leg) => sum + leg.units, 0n);
  const even = total / BigInt(sales.length);
  const last = total - even * BigInt(sales.length - 1);
  const sold = sales.map((leg, index) => {
    const share = index === sales.length - 1 ? last : even;
    const feeBase = leg.feeBase < share ? leg.feeBase : 0n;
    return trade(buys.length + index + 1, {
      sold: { asset: token, base: share - feeBase },
      feeBase,
      bought: { asset: stable, base: leg.units },
      gas: { asset: coin, base: leg.gasBase },
      soldPrice: leg.price,
      gasPrice: leg.price,
    });
  });
  return [...bought, ...sold];
}

async function closedFigures(trades: readonly ExecutedTrade[]): Promise<PositionFigures> {
  const store = createMemoryPositionStore();
  const positions = createPositions({ store, prices: createFakePriceSource(new Map()) });
  await inOrder(trades, async (each) => positions.record(each, live()));
  const valued = await positions.value({ walletId, isPaper: false }, live());
  const executions = await store.executions(
    { walletId, isPaper: false, after: 0, limit: 100 },
    live(),
  );
  const held = valued.find(({ position }) => position.asset === token);
  if (held === undefined) {
    throw new BinferenceError({
      code: "engine.fixture_no_position",
      message: "The buys open no position in the token.",
    });
  }
  return positionFigures(held, { executions, arrivals: [], sinceMs: 0 });
}

function percentBps(figures: PositionFigures): bigint {
  const [, , closed] = drawPnlCard({ figures, agentName: "main", info: tokenInfo });
  const percent: CardValue | undefined = closed?.values["percent"];
  return percent?.type === "percentChange" ? percent.bps : 0n;
}

describe("a closed position's figures", () => {
  it("realize what the sales brought in, less their gas, minus what the buys cost", async () => {
    await fc.assert(
      fc.asyncProperty(legs, legs, async (buys, sales) => {
        const figures = await closedFigures(roundTrip(buys, sales));
        expect(figures.quantityBase).toBe(0n);
        expect(figures.realizedUsdMicros).toBe(figures.soldUsdMicros - figures.boughtUsdMicros);
      }),
      { numRuns: 60 },
    );
  });

  it("show a share that never makes a gain larger or a loss smaller than it is", () => {
    const closed = fc.record({
      realized: fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
      bought: fc.bigInt({ min: 1n, max: 10n ** 15n }),
    });
    fc.assert(
      fc.property(closed, ({ realized, bought }) => {
        const figures: PositionFigures = {
          asset: token,
          isPaper: false,
          quantityBase: 0n,
          costUsdMicros: 0n,
          realizedUsdMicros: realized,
          boughtUsdMicros: bought,
          soldUsdMicros: bought + realized,
          venueFeeUsdMicros: 0n,
          networkFeeUsdMicros: 0n,
          sales: 1,
          changedAtMs: 0,
        };
        const bps = percentBps(figures);
        expect(bps * bought <= realized * 10_000n).toBe(true);
        expect((bps + 1n) * bought > realized * 10_000n).toBe(true);
      }),
    );
  });
});
