import {
  type AccountRef,
  type AssetRef,
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  isTxHash,
  type UsdPrice,
} from "@binference/chain";
import type { FakeStakingVenue } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import type { IntentView, PortfolioView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import {
  expectOk,
  testAgent,
  testCoin,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { createPositions } from "../positions/create-positions.js";
import {
  holdStakeWallet,
  stakeRequest,
  startStakeEngine,
  testStakingFake,
  testUnbondingSeconds,
  testValidator,
} from "../staking/test-stakes.js";
import { testAccount, testCall, type TestEngine } from "./test-engine.js";

const live = { signal: new AbortController().signal };
const oneCoin = 10n ** 18n;
const receipt: AssetRef = assetRefSchema.parse("fake:1/token:0x000000c1");
const coin = (base: bigint) => ({ asset: testCoin, base });
// $600 a coin; the token stands for a liquid staking token worth 1.04 coins, $624 a whole token.
const coinPrice: UsdPrice = { numerator: 600n, denominator: 10n ** 12n };
const tokenPrice: UsdPrice = { numerator: 624n, denominator: 1n };
const recipient: AccountRef = accountRefSchema.parse("fake:2:0x0000000c");
const depositTx = `0x${"ab".repeat(32)}`;

// The fake venue, whose pool prices 100 receipt units at `coinUnits` units of the coin.
function pooledVenue(coinUnits: bigint): FakeStakingVenue {
  return {
    ...testStakingFake(),
    pools: async (receipts) =>
      Promise.resolve(
        receipts
          .filter((asset) => asset === receipt)
          .map(() => ({
            validator: testValidator,
            pool: { shares: { asset: receipt, base: 100n }, coin: coin(coinUnits) },
          })),
      ),
  };
}

async function confirmed(test: TestEngine, request = stakeRequest("stake")): Promise<IntentView> {
  const { handlers } = test.engine;
  const view = expectOk(await handlers["intent/propose"](testCall(request)));
  const card = view.card;
  if (card === undefined) {
    throw new Error("The intent has no card.");
  }
  const call = { intent: view.intent, card: card.card, cardVersion: card.version };
  return expectOk(await handlers["intent/confirm"](testCall(call)));
}

async function portfolioOf(test: TestEngine): Promise<PortfolioView> {
  return expectOk(await test.engine.handlers["portfolio/get"](testCall({ agent: testAgent })));
}

// A live stake of one coin booked as it lands, a live unstake's coin ready to claim, and a live
// bridge of 50 tokens in transit, each under an intent of the wallet.
async function liveFixture(test: TestEngine, intents: readonly Id<"int">[]): Promise<void> {
  const [staked, unstaked, bridged] = intents;
  if (
    staked === undefined ||
    unstaked === undefined ||
    bridged === undefined ||
    !isTxHash(depositTx)
  ) {
    throw new Error("The fixture needs three intents.");
  }
  const positions = createPositions({ store: test.positions, prices: test.engineOptions.prices });
  const base = { walletId: testWallet, isPaper: false, feeBase: 0n, gas: coin(0n) };
  expectOk(
    await positions.record(
      {
        ...base,
        intentId: staked,
        atMs: 1,
        sold: coin(oneCoin),
        bought: { asset: receipt, base: oneCoin },
        soldPrice: coinPrice,
        gasPrice: coinPrice,
      },
      live,
    ),
  );
  const { unbondings, bridges } = test.stores;
  await unbondings.open(
    {
      intentId: unstaked,
      walletId: testWallet,
      venue: "fake-staking",
      validator: testValidator,
      requestRef: "live-1",
      amount: coin(oneCoin / 10n),
      valueUsdMicros: 60_000_000n,
      readyAtMs: 1,
      isPaper: false,
    },
    live,
  );
  await bridges.open(
    {
      intentId: bridged,
      venue: "fake-bridge",
      depositTx,
      toChain: chainRefSchema.parse("fake:2"),
      recipient,
      sent: { asset: testToken, base: 50_000_000n },
      minOut: { asset: assetRefSchema.parse("fake:2/slip44:1"), base: 1n },
      valueUsdMicros: 31_000_000_000n,
      sentAtMs: 1,
    },
    live,
  );
}

const paperBalanceTotal = (view: PortfolioView): bigint =>
  view.balances
    .filter((balance) => balance.paper)
    .reduce((sum, row) => sum + (row.usdMicros ?? 0n), 0n);

const paperTotalOf = (view: PortfolioView): bigint => view.paperTotalUsdMicros ?? 0n;

const stakesOf = (view: PortfolioView, mode: { readonly paper: boolean }) =>
  (view.staking ?? []).filter((held) => held.paper === mode.paper);

async function startFixture(venue: FakeStakingVenue = pooledVenue(105n)): Promise<TestEngine> {
  const held = [
    coin(2n * oneCoin),
    { asset: receipt, base: oneCoin },
    { asset: testToken, base: 3_000_000n },
  ];
  const test = await startStakeEngine(venue, {
    held: new Map([[testAccount, held]]),
    prices: new Map([
      [testCoin, coinPrice],
      [testToken, tokenPrice],
    ]),
  });
  holdStakeWallet(test);
  return test;
}

describe("a portfolio with stakes, unbonding coin and a bridge in transit", () => {
  it("counts each live and paper dollar once, and never adds the two together", async () => {
    const test = await startFixture();
    const before = await portfolioOf(test);
    const stake = await confirmed(test);
    const half = { asset: testCoin, base: oneCoin / 4n };
    await confirmed(test, stakeRequest("unstake", { amount: half }));
    const other = await confirmed(test, stakeRequest("stake", { amount: coin(oneCoin / 5n) }));
    const pending = expectOk(
      await test.engine.handlers["intent/propose"](testCall(stakeRequest("stake"))),
    );
    await liveFixture(test, [stake.intent, other.intent, pending.intent]);
    const view = await portfolioOf(test);
    // Live: 2 coins $1,200, one receipt unit worth 1.05 coins $630, 3 tokens at $624 $1,872, a
    // tenth of a coin to claim $60, and 50 tokens in transit at the $31,000 they left with.
    expect(view.totalUsdMicros).toBe(
      1_200_000_000n + 630_000_000n + 1_872_000_000n + 60_000_000n + 31_000_000_000n,
    );
    expect(view.inTransit).toStrictEqual([
      {
        intent: pending.intent,
        wallet: testWallet,
        amount: { asset: testToken, base: 50_000_000n },
        usdMicros: 31_000_000_000n,
        toChain: "fake:2",
        recipient,
        sentAt: 1,
        late: false,
      },
    ]);
    // A quarter coin unbonding, at $600 a coin.
    expect(view.paperTotalUsdMicros).toBe(paperBalanceTotal(view) + 150_000_000n);
    expect(stakesOf(view, { paper: true })).toStrictEqual([
      {
        wallet: testWallet,
        venue: "fake-staking",
        validator: testValidator,
        staked: { asset: receipt, base: oneCoin / 2n + oneCoin / 5n - oneCoin / 4n },
        stakedValue: coin(((oneCoin / 2n + oneCoin / 5n - oneCoin / 4n) * 105n) / 100n),
        unbonding: [{ amount: half, readyAt: testNowMs + testUnbondingSeconds * 1_000 }],
        claimable: coin(0n),
        paper: true,
      },
    ]);
    expect(before.paperTotalUsdMicros).toBe(3_000_000_000n);
    expect(stakesOf(view, { paper: false })).toStrictEqual([
      {
        wallet: testWallet,
        venue: "fake-staking",
        validator: testValidator,
        staked: { asset: receipt, base: oneCoin },
        stakedValue: coin((oneCoin * 105n) / 100n),
        unbonding: [],
        claimable: coin(oneCoin / 10n),
        paper: false,
      },
    ]);
  });

  it("moves a paper stake's value from the coin into the receipt units, then into its unbonding and back", async () => {
    const venue = pooledVenue(100n);
    const test = await startFixture(venue);
    const totals: bigint[] = [];
    const read = async () => totals.push(paperTotalOf(await portfolioOf(test)));
    await read();
    await confirmed(test);
    await read();
    await confirmed(test, stakeRequest("unstake", { amount: coin(oneCoin / 4n) }));
    await read();
    await test.clock.advance(testUnbondingSeconds * 1_000 + 1);
    venue.wait(testUnbondingSeconds + 1);
    await read();
    await confirmed(test, stakeRequest("claim"));
    await read();
    // At one coin a receipt unit, each move only moves value: the paper total never changes.
    expect(new Set(totals)).toStrictEqual(new Set([3_000_000_000n]));
    expect(totals).toHaveLength(5);
  });

  it("shows the receipt units with no value and leaves them out of the total when the venue does not answer", async () => {
    const venue = { ...pooledVenue(105n), pools: async () => Promise.reject(new Error("down")) };
    const test = await startStakeEngine(venue);
    holdStakeWallet(test);
    await confirmed(test);
    const view = await portfolioOf(test);
    const receiptBalance = view.balances.find(({ amount }) => amount.asset === receipt);
    expect(receiptBalance).toStrictEqual({
      wallet: testWallet,
      amount: { asset: receipt, base: oneCoin / 2n },
      paper: true,
    });
    expect(view.paperTotalUsdMicros).toBe(2_700_000_000n);
    const args = { agent: testAgent, from: 0, to: testNowMs };
    const pnl = expectOk(await test.engine.handlers["portfolio/pnl"](testCall(args)));
    expect(pnl.paperPositions).toContainEqual({ asset: receipt, realizedUsdMicros: 0n });
  });

  it("lists the coin of an unstake at a venue the engine no longer runs, valued, with no receipt units", async () => {
    const test = await startStakeEngine(pooledVenue(105n));
    holdStakeWallet(test);
    const pending = expectOk(
      await test.engine.handlers["intent/propose"](testCall(stakeRequest("stake"))),
    );
    await test.stores.unbondings.open(
      {
        intentId: pending.intent,
        walletId: testWallet,
        venue: "gone-staking",
        validator: testValidator,
        requestRef: "gone-1",
        amount: coin(oneCoin / 10n),
        readyAtMs: 1,
        isPaper: false,
      },
      live,
    );
    const view = await portfolioOf(test);
    expect(stakesOf(view, { paper: false })).toStrictEqual([
      {
        wallet: testWallet,
        venue: "gone-staking",
        validator: testValidator,
        unbonding: [],
        claimable: coin(oneCoin / 10n),
        paper: false,
      },
    ]);
    expect(view.totalUsdMicros).toBe(60_000_000n);
  });

  it("values a live stake's receipt units in its P&L at the pool, and its yield as unrealized", async () => {
    const test = await startFixture();
    const stake = await confirmed(test);
    const other = await confirmed(test, stakeRequest("stake", { amount: coin(oneCoin / 5n) }));
    const pending = expectOk(
      await test.engine.handlers["intent/propose"](testCall(stakeRequest("stake"))),
    );
    await liveFixture(test, [stake.intent, other.intent, pending.intent]);
    const args = { agent: testAgent, from: 0, to: testNowMs };
    const pnl = expectOk(await test.engine.handlers["portfolio/pnl"](testCall(args)));
    // One coin staked at $600 is worth 1.05 coins now: $30 unrealized.
    expect(pnl.positions).toContainEqual({
      asset: receipt,
      realizedUsdMicros: 0n,
      unrealizedUsdMicros: 30_000_000n,
    });
  });

  it("shows a liquid staking token with no price as a balance without a value, never in a total", async () => {
    const test = await startStakeEngine(pooledVenue(105n), {
      held: new Map([[testAccount, [coin(oneCoin), { asset: testToken, base: 3_000_000n }]]]),
      prices: new Map([[testCoin, coinPrice]]),
    });
    holdStakeWallet(test);
    const view = await portfolioOf(test);
    expect(view.balances.filter((balance) => !balance.paper)).toStrictEqual([
      { wallet: testWallet, amount: coin(oneCoin), usdMicros: 600_000_000n, paper: false },
      { wallet: testWallet, amount: { asset: testToken, base: 3_000_000n }, paper: false },
    ]);
    expect(view.totalUsdMicros).toBe(600_000_000n);
  });

  it("lists unbonding coin of a validator no units are held with, by the venue's receipt", async () => {
    const test = await startFixture();
    const pending = expectOk(
      await test.engine.handlers["intent/propose"](testCall(stakeRequest("stake"))),
    );
    await test.stores.unbondings.open(
      {
        intentId: pending.intent,
        walletId: testWallet,
        venue: "fake-staking",
        validator: testValidator,
        requestRef: "live-2",
        amount: coin(oneCoin / 10n),
        readyAtMs: testNowMs + 1,
        isPaper: false,
      },
      live,
    );
    const view = await portfolioOf(test);
    expect(stakesOf(view, { paper: false })).toStrictEqual([
      {
        wallet: testWallet,
        venue: "fake-staking",
        validator: testValidator,
        staked: { asset: receipt, base: 0n },
        unbonding: [{ amount: coin(oneCoin / 10n), readyAt: testNowMs + 1 }],
        claimable: coin(0n),
        paper: false,
      },
    ]);
  });
});
