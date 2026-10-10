import type { AssetRef, UsdPrice } from "@binference/chain";
import { err, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { inOrder } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { createPositions, type Positions } from "../positions/create-positions.js";
import type { ExecutedTrade } from "../positions/value-execution.js";
import { startTestEngine, type TestEngine, testCall } from "./test-engine.js";

const live = { signal: new AbortController().signal };
const dayMs = 86_400_000;
const whole = 10n ** 18n;
const tokens = (n: bigint): bigint => n * 1_000_000n;
// Dollars per whole coin, and per whole token of 6 decimals, as micro-dollars per base unit.
const perCoin = (dollars: bigint): UsdPrice => ({ numerator: dollars, denominator: 10n ** 12n });
const perToken = (micros: bigint): UsdPrice => ({ numerator: micros, denominator: 1_000_000n });
const archived = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000002");

function trade(n: number, fields: Partial<ExecutedTrade>): ExecutedTrade {
  return {
    intentId: idSchema("int").parse(`int_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`),
    walletId: testWallet,
    isPaper: false,
    atMs: testNowMs,
    sold: { asset: testCoin, base: whole / 2n },
    feeBase: 0n,
    bought: { asset: testToken, base: tokens(250n) },
    gas: { asset: testCoin, base: 0n },
    soldPrice: perCoin(500n),
    gasPrice: perCoin(500n),
    ...fields,
  };
}

/*
 * The paper portfolio starts with 1 coin bought at $600, and 1 live coin arrives at $600.
 *
 * 1. Live, now: 0.5 coin sells at $500 for 250 tokens. The coin realizes 250 - 300 = -$50.
 * 2. Paper, now: 0.5 coin sells at $700 for 350 tokens. The coin realizes 350 - 300 = $50.
 * 3. Live, two days on: 100 of the 250 live tokens sell at $1.20 for 0.2 coin. The token
 *    realizes 120 - 100 = $20.
 *
 * Now a coin is worth $600 and a token $2. Live: 0.7 coin cost 300 + 120 = $420 and is worth
 * $420; 150 tokens cost $150 and are worth $300. Paper: 0.5 coin cost $300 and is worth $300;
 * 350 tokens cost $350 and are worth $700.
 */
interface Traded {
  readonly test: TestEngine;
  /** The positions the trades were recorded through, at the prices of their time. */
  readonly positions: Positions;
}

async function traded(prices: ReadonlyMap<AssetRef, UsdPrice>): Promise<Traded> {
  const test = await startTestEngine({ prices });
  for (const [id, createdAtMs, archivedAtMs] of [
    [testWallet, 1, undefined],
    [archived, 2, 3],
  ] as const) {
    const record = testWalletRecord({ id, agentId: testAgent, label: "main", createdAtMs });
    test.stores.install.addWallet(
      archivedAtMs === undefined ? record : { ...record, archivedAtMs },
    );
  }
  const positions = createPositions({
    store: test.positions,
    prices: createFakePriceSource(prices),
  });
  const received = { asset: testCoin, base: whole };
  await positions.receive({ walletId: testWallet, isPaper: false, atMs: 1, received }, live);
  const trades = [
    trade(1, {}),
    trade(2, {
      isPaper: true,
      soldPrice: perCoin(700n),
      bought: { asset: testToken, base: tokens(350n) },
    }),
    trade(3, {
      walletId: testWallet,
      atMs: testNowMs + 2 * dayMs,
      sold: { asset: testToken, base: tokens(100n) },
      bought: { asset: testCoin, base: whole / 5n },
      soldPrice: perToken(1_200_000n),
    }),
  ];
  const recorded = await inOrder(trades, async (executed) => positions.record(executed, live));
  expect(recorded.map((result) => result.ok)).toStrictEqual([true, true, true]);
  return { test, positions };
}

const pricesNow = new Map<AssetRef, UsdPrice>([
  [testCoin, perCoin(600n)],
  [testToken, perToken(2_000_000n)],
]);

async function pnl({ test }: Traded, from: number, to: number) {
  return test.engine.handlers["portfolio/pnl"](testCall({ agent: testAgent, from, to }));
}

describe("the P&L read", () => {
  it("sums what the range's executions realized, live and paper apart, with today's unrealized", async () => {
    const view = expectOk(await pnl(await traded(pricesNow), testNowMs, testNowMs + dayMs));
    expect(view).toStrictEqual({
      positions: [
        { asset: testCoin, realizedUsdMicros: -50_000_000n, unrealizedUsdMicros: 0n },
        { asset: testToken, realizedUsdMicros: 0n, unrealizedUsdMicros: 150_000_000n },
      ],
      realizedUsdMicros: -50_000_000n,
      unrealizedUsdMicros: 150_000_000n,
      paperPositions: [
        { asset: testCoin, realizedUsdMicros: 50_000_000n, unrealizedUsdMicros: 0n },
        { asset: testToken, realizedUsdMicros: 0n, unrealizedUsdMicros: 350_000_000n },
      ],
      paperRealizedUsdMicros: 50_000_000n,
      paperUnrealizedUsdMicros: 350_000_000n,
      assets: {
        [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
        [testToken]: { symbol: "TKN", name: "Token", decimals: 6, verified: true },
      },
    });
  });

  it("counts an execution at either end of the range, and none outside it", async () => {
    const subject = await traded(pricesNow);
    const later = expectOk(await pnl(subject, testNowMs + 1, testNowMs + 2 * dayMs));
    expect([later.realizedUsdMicros, later.paperRealizedUsdMicros]).toStrictEqual([
      20_000_000n,
      0n,
    ]);
    const both = expectOk(await pnl(subject, testNowMs, testNowMs + 2 * dayMs));
    expect(both.realizedUsdMicros).toBe(-30_000_000n);
  });

  it("counts the trades of a wallet the agent archived since", async () => {
    const subject = await traded(pricesNow);
    const received = { asset: testCoin, base: whole };
    const arrival = { walletId: archived, isPaper: false, atMs: 1, received };
    await subject.positions.receive(arrival, live);
    expectOk(await subject.positions.record(trade(4, { walletId: archived }), live));
    const view = expectOk(await pnl(subject, testNowMs, testNowMs));
    expect(view.realizedUsdMicros).toBe(-100_000_000n);
  });

  it("leaves the unrealized P&L out of an asset with no price, and out of its total", async () => {
    const view = expectOk(
      await pnl(await traded(new Map([[testCoin, perCoin(600n)]])), testNowMs, testNowMs),
    );
    expect(view.positions[1]).toStrictEqual({ asset: testToken, realizedUsdMicros: 0n });
    expect([view.unrealizedUsdMicros, view.paperUnrealizedUsdMicros]).toStrictEqual([
      undefined,
      undefined,
    ]);
  });

  it("refuses an unknown agent and a range that ends before it starts", async () => {
    const subject = await traded(pricesNow);
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");
    const handler = subject.test.engine.handlers["portfolio/pnl"];
    expect([
      await handler(testCall({ agent: stranger, from: 0, to: 1 })),
      await pnl(subject, 2, 1),
    ]).toStrictEqual([err("agent.not_found"), err("protocol.bad_args")]);
  });
});
