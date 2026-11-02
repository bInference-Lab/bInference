import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  chainRefSchema,
} from "@binference/chain";
import { mulDiv, type Ratio } from "@binference/core";
import type { PortfolioView } from "@binference/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TransitHolding } from "../bridges/bridges-in-transit.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testCoin } from "../intents/test-intents.js";
import { stakingChains, testValidator } from "../staking/test-stakes.js";
import type { UnbondingRecord } from "../staking/unbonding-record.js";
import { type HeldElsewhere, portfolioViewOf, type WalletHoldings } from "./portfolio-view.js";
import { type StakeHolding, stakeHoldingsOf } from "./stake-holdings.js";

const chains = stakingChains();
const walletId = fixtureId("wal", 1);
const receipt: AssetRef = assetRefSchema.parse("fake:1/token:0x000000c1");
const token: AssetRef = assetRefSchema.parse("fake:1/token:0x0000000a");
// What the agent's own wallet holds on the destination chain, which a delivery never pays.
const elsewhereCoin: AssetRef = assetRefSchema.parse("fake:2/slip44:1");
const recipient: AccountRef = accountRefSchema.parse("fake:2:0x0000000c");
const usd = fc.bigInt({ min: 0n, max: 10n ** 12n });

/**
 * One wallet in one mode, every amount worth one micro-dollar a unit so a move keeps its value
 * exactly: the coin, the receipt units, a token, the destination chain's coin, the coin waiting in
 * unbonding rows, and the bridges in transit.
 */
interface Model {
  readonly coin: bigint;
  readonly staked: bigint;
  readonly token: bigint;
  readonly elsewhere: bigint;
  readonly waiting: bigint;
  readonly transit: readonly bigint[];
}

/** A move of the model: a share in percent of what it takes from, or a bridge in transit. */
interface Move {
  readonly kind: "stake" | "unstake" | "claim" | "bridge" | "deliver" | "refund";
  readonly part: bigint;
  readonly index: number;
}

const moves: fc.Arbitrary<readonly Move[]> = fc.array(
  fc.record({
    kind: fc.constantFrom("stake", "unstake", "claim", "bridge", "deliver", "refund"),
    part: fc.bigInt({ min: 0n, max: 100n }),
    index: fc.nat({ max: 5 }),
  }),
  { maxLength: 30 },
);

const percentOf = (whole: bigint, part: bigint): bigint => (whole * part) / 100n;

/** A model after a move, and what left the agent by it: only a delivery pays outside. */
interface Applied {
  readonly next: Model;
  readonly left: bigint;
}

// A bridge in transit settles: a delivery pays the recipient, a refund pays the wallet back.
function settle(model: Model, move: Move): Applied {
  const amount = model.transit[move.index];
  if (amount === undefined) {
    return { next: model, left: 0n };
  }
  const transit = model.transit.filter((_, index) => index !== move.index);
  return move.kind === "deliver"
    ? { next: { ...model, transit }, left: amount }
    : { next: { ...model, transit, token: model.token + amount }, left: 0n };
}

// What each kind of move does to the model; no move but a delivery pays outside.
const steps: Readonly<Record<Move["kind"], (model: Model, move: Move) => Model | Applied>> = {
  stake: (model, { part }) => {
    const moved = percentOf(model.coin, part);
    return { ...model, coin: model.coin - moved, staked: model.staked + moved };
  },
  unstake: (model, { part }) => {
    const moved = percentOf(model.staked, part);
    return { ...model, staked: model.staked - moved, waiting: model.waiting + moved };
  },
  claim: (model) => ({ ...model, coin: model.coin + model.waiting, waiting: 0n }),
  bridge: (model, { part }) => {
    const moved = percentOf(model.token, part);
    return { ...model, token: model.token - moved, transit: [...model.transit, moved] };
  },
  deliver: settle,
  refund: settle,
};

function apply(model: Model, move: Move): Applied {
  const done = steps[move.kind](model, move);
  return "next" in done ? done : { next: done, left: 0n };
}

const held = (asset: AssetRef, base: bigint) => ({ amount: { asset, base }, usdMicros: base });

function viewOf(model: Model, mode: { readonly paper: boolean }): PortfolioView {
  const isPaper = mode.paper;
  const holdings: WalletHoldings = {
    walletId,
    isPaper,
    balances: [
      held(testCoin, model.coin),
      held(receipt, model.staked),
      held(token, model.token),
      held(elsewhereCoin, model.elsewhere),
    ],
    positions: [],
  };
  const stake: StakeHolding = {
    walletId,
    isPaper,
    venue: "fake-staking",
    validator: testValidator,
    staked: { asset: receipt, base: model.staked },
    unbonding: [],
    claimable: { asset: testCoin, base: model.waiting },
    waitingUsdMicros: model.waiting,
  };
  const inTransit: readonly TransitHolding[] = model.transit.map((amount, index) => ({
    intentId: fixtureId("int", index + 1),
    walletId,
    amount: { asset: token, base: amount },
    usdMicros: amount,
    toChain: chainRefSchema.parse("fake:2"),
    recipient,
    sentAtMs: 1,
    late: false,
  }));
  const elsewhere: HeldElsewhere = { staking: [stake], ...(isPaper ? {} : { inTransit }) };
  return portfolioViewOf([holdings], chains, elsewhere);
}

const models: fc.Arbitrary<Model> = fc.record({
  coin: usd,
  staked: fc.constant(0n),
  token: usd,
  elsewhere: usd,
  waiting: fc.constant(0n),
  transit: fc.constant([]),
});

// What the destination chain's balance of the view holds.
const elsewhereOf = (view: PortfolioView): bigint =>
  view.balances
    .filter(({ amount }) => amount.asset === elsewhereCoin)
    .reduce((sum, { amount }) => sum + amount.base, 0n);

const totalOf = (balances: PortfolioView["balances"]): bigint =>
  balances.reduce((sum, row) => sum + (row.usdMicros ?? 0n), 0n);

const balancesOf = (view: PortfolioView) =>
  view.balances.map(({ amount, usdMicros }) =>
    usdMicros === undefined ? { amount } : { amount, usdMicros },
  );

// The live and the paper view's balances side by side, in one portfolio with no stake or bridge.
function bothOf(liveView: PortfolioView, paperView: PortfolioView): PortfolioView {
  return portfolioViewOf(
    [
      { walletId, isPaper: false, balances: balancesOf(liveView), positions: [] },
      { walletId, isPaper: true, balances: balancesOf(paperView), positions: [] },
    ],
    chains,
  );
}

function rowOf(index: number, base: bigint, readyAtMs: number): UnbondingRecord {
  return {
    id: index + 1,
    intentId: fixtureId("int", index + 1),
    walletId,
    venue: "fake-staking",
    validator: testValidator,
    requestRef: `r:${String(index)}`,
    amount: { asset: testCoin, base },
    readyAtMs,
    isPaper: false,
  };
}

/** What one validator's unbondings split into: claimable and waiting coin, and their value. */
interface Split {
  readonly entries: number;
  readonly coin: bigint;
  readonly usdMicros: bigint;
}

function splitOf(
  rows: readonly UnbondingRecord[],
  at: { readonly nowMs: number; readonly price: Ratio },
): Split {
  const holdings = stakeHoldingsOf({
    walletId,
    isPaper: false,
    balances: [],
    rows,
    pools: new Map(),
    receipts: new Map([[`fake-staking ${testValidator}`, receipt]]),
    coinPrices: new Map([[testCoin, at.price]]),
    nowMs: at.nowMs,
  });
  const coin = holdings.reduce(
    (sum, stake) =>
      sum +
      stake.claimable.base +
      stake.unbonding.reduce((part, row) => part + row.amount.base, 0n),
    0n,
  );
  const usdMicros = holdings.reduce((sum, stake) => sum + (stake.waitingUsdMicros ?? 0n), 0n);
  return { entries: holdings.length, coin, usdMicros };
}

const prices: fc.Arbitrary<Ratio> = fc.record({
  numerator: fc.bigInt({ min: 1n, max: 10n ** 9n }),
  denominator: fc.bigInt({ min: 1n, max: 10n ** 18n }),
});

const unbondings: fc.Arbitrary<readonly UnbondingRecord[]> = fc
  .array(fc.record({ base: usd, readyAtMs: fc.nat({ max: 100 }) }), { minLength: 1, maxLength: 8 })
  .map((specs: readonly { readonly base: bigint; readonly readyAtMs: number }[]) =>
    specs.map((spec, index) => rowOf(index, spec.base, spec.readyAtMs)),
  );

/** The model as each move leaves it, and what left the agent so far. */
interface Run {
  readonly model: Model;
  readonly left: bigint;
  readonly checks: readonly (readonly [bigint, bigint])[];
}

// After each move: the live total with what left the agent added back, and the destination
// chain's balance.
function checksOf(start: Model, run: readonly Move[]): Run["checks"] {
  const first: Run = { model: start, left: 0n, checks: [] };
  return run.reduce((state: Run, move: Move): Run => {
    const applied = apply(state.model, move);
    const left = state.left + applied.left;
    const view = viewOf(applied.next, { paper: false });
    const check = [view.totalUsdMicros + left, elsewhereOf(view)] as const;
    return { model: applied.next, left, checks: [...state.checks, check] };
  }, first).checks;
}

describe("each dollar of a portfolio counts once", () => {
  it("keeps the total through stakes, unstakes, claims and bridges, less only what a delivery paid out", () => {
    fc.assert(
      fc.property(models, moves, (start, run) => {
        const before = viewOf(start, { paper: false }).totalUsdMicros;
        expect(checksOf(start, run)).toStrictEqual(run.map(() => [before, start.elsewhere]));
      }),
      { numRuns: 200 },
    );
  });

  it("never adds a paper dollar to the live total, or a live one to the paper total", () => {
    fc.assert(
      fc.property(models, models, moves, (live, paper, run) => {
        const settled = run.reduce((model, move) => apply(model, move).next, paper);
        const liveView = viewOf(live, { paper: false });
        const paperView = viewOf(settled, { paper: true });
        const both = bothOf(liveView, paperView);
        expect([both.totalUsdMicros, both.paperTotalUsdMicros]).toStrictEqual([
          totalOf(liveView.balances),
          totalOf(paperView.balances),
        ]);
      }),
      { numRuns: 100 },
    );
  });

  it("splits a validator's unbondings into claimable and waiting coin once, valued down at the price now", () => {
    fc.assert(
      fc.property(unbondings, fc.nat({ max: 100 }), prices, (rows, nowMs, price) => {
        const all = rows.reduce((sum, row) => sum + row.amount.base, 0n);
        expect(splitOf(rows, { nowMs, price })).toStrictEqual({
          entries: 1,
          coin: all,
          usdMicros: mulDiv(all, price, "down"),
        });
      }),
      { numRuns: 200 },
    );
  });
});
