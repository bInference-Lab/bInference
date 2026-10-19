import { type AssetRef, assetRefSchema, type UsdPrice } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { AssetInfo } from "@binference/protocol";
import { fixtureId, inOrder, live } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { createPositions } from "../positions/create-positions.js";
import type { ExecutedTrade } from "../positions/value-execution.js";
import { positionFigures, type PositionFigures } from "./position-figures.js";

// The chain's coin, the traded token and a stablecoin; every one has 18 decimals.
const coin: AssetRef = assetRefSchema.parse("fake:1/slip44:1");
/** The token the hand-worked example trades. */
export const token: AssetRef = assetRefSchema.parse(`fake:1/token:0x${"ab".repeat(20)}`);
// The stablecoin the token is sold for.
const stable: AssetRef = assetRefSchema.parse("fake:1/token:0x0000000b");
/** The token's info, as the registry lists it. */
export const tokenInfo: AssetInfo = { symbol: "TKN", name: "Token", decimals: 18, verified: true };

const walletId = fixtureId("wal", 1);
const whole = 10n ** 18n;
const milli = whole / 1_000n;

// A price in micro-dollars per whole 18-decimal unit.
const usd = (micros: bigint): UsdPrice => ({ numerator: micros, denominator: whole });

function trade(n: number, atMs: number, fields: Partial<ExecutedTrade>): ExecutedTrade {
  return {
    intentId: fixtureId("int", n),
    walletId,
    isPaper: false,
    atMs,
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
 * The hand-worked example (decision 0243). Every number was worked out on paper; the tests check
 * the code against them. Prices are dollars per whole token. A fee is paid on top of the units
 * sold, in the sold token; gas is paid in BNB.
 *
 * 1. Oct 2, 14:05: buy 1,000 TKN with 1 BNB at $600. Fee 0.0025 BNB, gas 0.0005 BNB.
 *    value $600.00, fee 0.0025 x 600 = $1.50, gas 0.0005 x 600 = $0.30
 *    TKN: 1,000 held, cost 600.00 + 1.50 + 0.30 = $601.80
 * 2. Oct 3, 09:00: buy 400 TKN with 0.5 BNB at $640. Fee 0.00125 BNB, gas 0.0005 BNB.
 *    value $320.00, fee 0.00125 x 640 = $0.80, gas 0.0005 x 640 = $0.32
 *    TKN: 1,400 held, cost 601.80 + 320.00 + 0.80 + 0.32 = $922.92
 * 3. Oct 5, 12:00: sell 700 TKN at $0.80 for 560 USDT. Fee 1.75 TKN, gas 0.0004 BNB at $650.
 *    value 700 x 0.80 = $560.00, fee 1.75 x 0.80 = $1.40, gas 0.0004 x 650 = $0.26
 *    TKN gives up 701.75 units: cost out 922.92 x 701.75 / 1,400 = $462.61365
 *    TKN realized in the ledger: 560.00 + 1.40 - 462.61365 = $98.78635
 *    TKN: 698.25 held, cost 922.92 - 462.61365 = $460.30635
 *
 * The open card, with TKN at $0.92 now:
 *    value 698.25 x 0.92 = $642.39; unrealized 642.39 - 460.30635 = +$182.08365
 *    percent 182.08365 / 460.30635 = 0.395571...: 3,955 basis points, +39.55%
 *    average cost 460.30635 / 698.25 = $0.6592285..., rounded up to $0.659229, shown $0.66
 *    realized net of the sale's fee and gas: 98.78635 - 1.40 - 0.26 = +$97.12635
 *    fees: venue 1.50 + 0.80 + 1.40 = $3.70; network 0.30 + 0.32 + 0.26 = $0.88
 *
 * 4. Oct 9, 09:12: sell the other 696.5 TKN at $0.95 for 661.675 USDT. Fee 1.75 TKN, gas 0.0004
 *    BNB at $660.
 *    value 696.5 x 0.95 = $661.675, fee 1.75 x 0.95 = $1.6625, gas 0.0004 x 660 = $0.264
 *    TKN gives up its last 698.25 units, so all its cost: $460.30635
 *    TKN realized in the ledger: 98.78635 + 661.675 + 1.6625 - 460.30635 = $301.8175
 *
 * The closed card:
 *    bought for: 601.80 + 321.12 = $922.92
 *    sold for, net of gas (the fee was paid on top): (560.00 - 0.26) + (661.675 - 0.264) = $1,221.151
 *    realized net of every fee and gas: 301.8175 - (1.40 + 0.26) - (1.6625 + 0.264) = +$298.231,
 *    the same as sold for minus bought for: 1,221.151 - 922.92 = $298.231
 *    percent 298.231 / 922.92 = 0.323138...: 3,231 basis points, +32.31%
 *    fees: venue 3.70 + 1.6625 = $5.3625; network 0.88 + 0.264 = $1.144
 *    held Oct 2, 14:05 to Oct 9, 09:12: 6 days and 19 hours, shown as 6 days
 *    Cash check: the wallet paid BNB worth 601.80 + 321.12 + 0.26 + 0.264 = $923.444 and received
 *    USDT worth 560.00 + 661.675 = $1,221.675; 1,221.675 - 923.444 = $298.231.
 */
const handWorkedOn = ({ isPaper }: { readonly isPaper: boolean }): readonly ExecutedTrade[] => [
  trade(1, Date.UTC(2026, 9, 2, 14, 5), {
    isPaper,
    feeBase: (2_500n * milli) / 1_000n,
    bought: { asset: token, base: 1_000n * whole },
    gas: { asset: coin, base: (500n * milli) / 1_000n },
  }),
  trade(2, Date.UTC(2026, 9, 3, 9, 0), {
    isPaper,
    sold: { asset: coin, base: whole / 2n },
    feeBase: (1_250n * milli) / 1_000n,
    bought: { asset: token, base: 400n * whole },
    gas: { asset: coin, base: (500n * milli) / 1_000n },
    soldPrice: usd(640_000_000n),
    gasPrice: usd(640_000_000n),
  }),
  trade(3, Date.UTC(2026, 9, 5, 12, 0), {
    isPaper,
    sold: { asset: token, base: 700n * whole },
    feeBase: 1_750n * milli,
    bought: { asset: stable, base: 560n * whole },
    gas: { asset: coin, base: (400n * milli) / 1_000n },
    soldPrice: usd(800_000n),
    gasPrice: usd(650_000_000n),
  }),
  trade(4, Date.UTC(2026, 9, 9, 9, 12), {
    isPaper,
    sold: { asset: token, base: 696_500n * milli },
    feeBase: 1_750n * milli,
    bought: { asset: stable, base: 661_675n * milli },
    gas: { asset: coin, base: (400n * milli) / 1_000n },
    soldPrice: usd(950_000n),
    gasPrice: usd(660_000_000n),
  }),
];

/** The hand-worked example's trades, live. */
export const handWorked: readonly ExecutedTrade[] = handWorkedOn({ isPaper: false });
/** The same trades on paper. */
export const handWorkedOnPaper: readonly ExecutedTrade[] = handWorkedOn({ isPaper: true });

/** The prices now: TKN at $0.92, USDT at $1.00, BNB at $650. */
export const pricesNow: ReadonlyMap<AssetRef, UsdPrice> = new Map([
  [token, usd(920_000n)],
  [stable, usd(1_000_000n)],
  [coin, usd(650_000_000n)],
]);

/** The prices now without the token's: it has none. */
export const pricesWithoutToken: ReadonlyMap<AssetRef, UsdPrice> = new Map([
  [stable, usd(1_000_000n)],
  [coin, usd(650_000_000n)],
]);

/**
 * The token's figures after the trades, as the money path stores and values its position, in the
 * mode of the first trade.
 */
export async function tokenFigures(
  trades: readonly ExecutedTrade[],
  prices: ReadonlyMap<AssetRef, UsdPrice>,
): Promise<PositionFigures> {
  const store = createMemoryPositionStore();
  const positions = createPositions({ store, prices: createFakePriceSource(prices) });
  await inOrder(trades, async (executed) => positions.record(executed, live()));
  const isPaper = trades[0]?.isPaper ?? false;
  const valued = await positions.value({ walletId, isPaper }, live());
  const executions = await store.executions({ walletId, isPaper, after: 0, limit: 100 }, live());
  const held = valued.find(({ position }) => position.asset === token);
  if (held === undefined) {
    throw new BinferenceError({
      code: "engine.fixture_no_position",
      message: "The trades open no position in the token.",
    });
  }
  return positionFigures(held, { executions, arrivals: [], sinceMs: 0 });
}
