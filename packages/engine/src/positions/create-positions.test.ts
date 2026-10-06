import { type AssetRef, assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { fixtureId, inOrder, live } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import type { PositionStore, UsdPrice } from "../ports.js";
import { createPositions, type ValuedPosition } from "./create-positions.js";
import type { ExecutedTrade } from "./value-execution.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const stable = assetRefSchema.parse("fake:1/token:b");
const unpriced = assetRefSchema.parse("fake:1/token:c");
const walletId = fixtureId("wal", 1);
const whole = 10n ** 18n;

// A price in dollars per whole 18-decimal unit, as micro-dollars per base unit.
const usd = (micros: bigint): UsdPrice => ({ numerator: micros, denominator: whole });

function trade(n: number, fields: Partial<ExecutedTrade>): ExecutedTrade {
  return {
    intentId: fixtureId("int", n),
    walletId,
    isPaper: false,
    atMs: 1_000 * n,
    sold: { asset: coin, base: whole },
    feeBase: 0n,
    bought: { asset: token, base: whole },
    gas: { asset: coin, base: 0n },
    soldPrice: usd(600_000_000n),
    gasPrice: usd(600_000_000n),
    ...fields,
  };
}

/*
 * The hand-worked example. Every number below was worked out on paper; the test only checks the
 * code against them. Prices are dollars per whole token; every token has 18 decimals.
 *
 * 1. Buy 1,000 TKN with 1 BNB at $600. Fee 0.0025 BNB on top, gas 0.0005 BNB.
 *    value 1 x 600 = $600.00, fee 0.0025 x 600 = $1.50, gas 0.0005 x 600 = $0.30
 *    TKN: 1,000 held, cost 600.00 + 1.50 + 0.30 = $601.80
 *    BNB came from a deposit binference never saw bought, so it leaves with no gain or loss.
 *
 * 2. Buy 400 TKN with 0.5 BNB at $640. Fee 0.00125 BNB, gas 0.0005 BNB.
 *    value 0.5 x 640 = $320.00, fee 0.00125 x 640 = $0.80, gas 0.0005 x 640 = $0.32
 *    TKN: 1,400 held, cost 601.80 + 320.00 + 0.80 + 0.32 = $922.92 (average $0.659229)
 *
 * 3. Sell 700 TKN at $0.80 for 558.6 USDT. Fee 1.75 TKN on top, gas 0.0004 BNB at $650.
 *    value 700 x 0.80 = $560.00, fee 1.75 x 0.80 = $1.40, gas 0.0004 x 650 = $0.26
 *    TKN gives up 701.75 of 1,400 units: cost out 922.92 x 701.75 / 1,400 = $462.61365
 *    TKN realized: proceeds 560.00 + 1.40 = $561.40, less 462.61365 = $98.78635
 *    TKN left: 698.25 held, cost 922.92 - 462.61365 = $460.30635
 *    USDT: 558.6 held, cost 560.00 + 1.40 + 0.26 = $561.66
 *
 * 4. Now TKN is $0.90 and USDT $1.00.
 *    TKN: value 698.25 x 0.90 = $628.425, unrealized 628.425 - 460.30635 = $168.11865
 *    USDT: value 558.6 x 1.00 = $558.60, unrealized 558.60 - 561.66 = -$3.06
 *    Realized plus unrealized: 98.78635 + 168.11865 - 3.06 = $263.845. The same from the cash:
 *    the wallet spent BNB worth 601.80 + 321.12 + 0.26 = $923.18 and holds 628.425 + 558.60 =
 *    $1,187.025; 1,187.025 - 923.18 = $263.845.
 */
const handWorked: readonly ExecutedTrade[] = [
  trade(1, {
    sold: { asset: coin, base: whole },
    feeBase: 2_500_000_000_000_000n,
    bought: { asset: token, base: 1_000n * whole },
    gas: { asset: coin, base: 500_000_000_000_000n },
  }),
  trade(2, {
    sold: { asset: coin, base: whole / 2n },
    feeBase: 1_250_000_000_000_000n,
    bought: { asset: token, base: 400n * whole },
    gas: { asset: coin, base: 500_000_000_000_000n },
    soldPrice: usd(640_000_000n),
    gasPrice: usd(640_000_000n),
  }),
  trade(3, {
    sold: { asset: token, base: 700n * whole },
    feeBase: 1_750_000_000_000_000_000n,
    bought: { asset: stable, base: 558_600_000_000_000_000_000n },
    gas: { asset: coin, base: 400_000_000_000_000n },
    soldPrice: usd(800_000n),
    gasPrice: usd(650_000_000n),
  }),
];

const pricesNow = new Map<AssetRef, UsdPrice>([
  [token, usd(900_000n)],
  [stable, usd(1_000_000n)],
]);

// Realized plus unrealized over every position; a position with no price adds its realized part.
function totalPnl(valued: readonly ValuedPosition[]): bigint {
  return valued.reduce(
    (sum, { position, unrealizedUsdMicros }) =>
      sum + position.realizedUsdMicros + (unrealizedUsdMicros ?? 0n),
    0n,
  );
}

async function recordAll(store: PositionStore): Promise<void> {
  const positions = createPositions({ store, prices: createFakePriceSource(pricesNow) });
  const recorded = await inOrder(handWorked, async (executed) =>
    positions.record(executed, live()),
  );
  expect(recorded.map((result) => result.ok)).toStrictEqual([true, true, true]);
}

describe("createPositions", () => {
  it("matches the hand-worked example with fees and gas", async () => {
    const store = createMemoryPositionStore();
    await recordAll(store);
    const positions = createPositions({ store, prices: createFakePriceSource(pricesNow) });
    const valued = await positions.value({ walletId, isPaper: false }, live());
    expect(valued).toStrictEqual([
      {
        position: {
          walletId,
          asset: token,
          isPaper: false,
          quantityBase: 698_250_000_000_000_000_000n,
          costUsdMicros: 460_306_350n,
          realizedUsdMicros: 98_786_350n,
          changedAtMs: 3_000,
          version: 2,
        },
        valueUsdMicros: 628_425_000n,
        unrealizedUsdMicros: 168_118_650n,
      },
      {
        position: {
          walletId,
          asset: stable,
          isPaper: false,
          quantityBase: 558_600_000_000_000_000_000n,
          costUsdMicros: 561_660_000n,
          realizedUsdMicros: 0n,
          changedAtMs: 3_000,
          version: 0,
        },
        valueUsdMicros: 558_600_000n,
        unrealizedUsdMicros: -3_060_000n,
      },
    ]);
    expect(totalPnl(valued)).toBe(263_845_000n);
  });

  it("stores each execution valued at its own time", async () => {
    const store = createMemoryPositionStore();
    await recordAll(store);
    const stored = await store.executions({ after: 0, limit: 10, isPaper: false }, live());
    expect(
      stored.map(({ valueUsdMicros, feeUsdMicros, gasUsdMicros }) => [
        valueUsdMicros,
        feeUsdMicros,
        gasUsdMicros,
      ]),
    ).toStrictEqual([
      [600_000_000n, 1_500_000n, 300_000n],
      [320_000_000n, 800_000n, 320_000n],
      [560_000_000n, 1_400_000n, 260_000n],
    ]);
  });

  it("stores nothing and answers stale when another execution moved a position first", async () => {
    const store = createMemoryPositionStore();
    const prices = createFakePriceSource(pricesNow);
    await createPositions({ store, prices }).record(trade(1, {}), live());
    // The rival lands between this call's read of the positions and its write.
    const racing: PositionStore = {
      ...store,
      positions: async (query, options) => {
        const held = await store.positions(query, options);
        await createPositions({ store, prices }).record(trade(8, {}), options);
        return held;
      },
    };
    const lost = await createPositions({ store: racing, prices }).record(trade(9, {}), live());
    expect(lost).toStrictEqual({ ok: false, error: "stale" });
    const stored = await store.executions({ after: 0, limit: 10, isPaper: false }, live());
    expect(stored.map((execution) => execution.intentId)).toStrictEqual([
      fixtureId("int", 1),
      fixtureId("int", 8),
    ]);
  });

  it("keeps paper positions apart from live ones", async () => {
    const store = createMemoryPositionStore();
    const positions = createPositions({ store, prices: createFakePriceSource(pricesNow) });
    await positions.record(trade(1, { isPaper: true }), live());
    await expect(positions.value({ walletId, isPaper: false }, live())).resolves.toStrictEqual([]);
    const paper = await positions.value({ walletId, isPaper: true }, live());
    expect(paper.map(({ position }) => [position.asset, position.isPaper])).toStrictEqual([
      [token, true],
    ]);
  });

  it("values a position with no price, a zero price or a malformed price as unknown", async () => {
    const store = createMemoryPositionStore();
    const zero = new Map<AssetRef, UsdPrice>([
      [token, usd(0n)],
      [stable, { numerator: 1n, denominator: 0n }],
    ]);
    await createPositions({ store, prices: createFakePriceSource(zero) }).record(
      trade(1, { bought: { asset: stable, base: whole } }),
      live(),
    );
    await createPositions({ store, prices: createFakePriceSource(zero) }).record(
      trade(2, {}),
      live(),
    );
    await createPositions({ store, prices: createFakePriceSource(zero) }).record(
      trade(3, { bought: { asset: unpriced, base: whole } }),
      live(),
    );
    const valued = await createPositions({ store, prices: createFakePriceSource(zero) }).value(
      { walletId, isPaper: false },
      live(),
    );
    expect(valued.map((entry) => Object.keys(entry))).toStrictEqual([
      ["position"],
      ["position"],
      ["position"],
    ]);
  });

  it("values a position that holds nothing at zero without asking for a price", async () => {
    const store = createMemoryPositionStore();
    const prices = createFakePriceSource(pricesNow);
    const positions = createPositions({ store, prices });
    await positions.record(trade(1, { bought: { asset: token, base: 10n } }), live());
    await positions.record(
      trade(2, { sold: { asset: token, base: 10n }, bought: { asset: stable, base: 5n } }),
      live(),
    );
    const valued = await positions.value({ walletId, isPaper: false }, live());
    expect(valued[0]).toMatchObject({ valueUsdMicros: 0n, unrealizedUsdMicros: 0n });
    expect(valued[0]?.position).toMatchObject({
      asset: token,
      quantityBase: 0n,
      costUsdMicros: 0n,
    });
    expect(prices.asked()).toStrictEqual([stable]);
  });
});
