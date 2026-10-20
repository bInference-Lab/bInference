import { cardOf, intentDraft, intentMove } from "../contracts/intent-fixtures.js";
import { activeOrder } from "../contracts/order-fill-checks.js";
import { fixtureId, live } from "../contracts/store-fixtures.js";
import { testAgent, testCoin, testLimits, testWallet } from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import type { OrderFillRecord } from "../orders/order-fill.js";
import { coins, type DayRig } from "./test-summary-parts.js";

const hourMs = 3_600_000;

// A trade of the fixture day: the wallet sold a coin, realizing the given dollars.
async function trade(
  rig: DayRig,
  at: {
    readonly n: number;
    readonly atMs: number;
    readonly isPaper: boolean;
    readonly realized: bigint;
  },
) {
  const execution = {
    intentId: fixtureId("int", 90 + at.n),
    walletId: testWallet,
    isPaper: at.isPaper,
    atMs: at.atMs,
    sold: coins(1n),
    feeBase: 0n,
    bought: coins(1n),
    gas: { asset: testCoin, base: 0n },
    valueUsdMicros: 600_000_000n,
    feeUsdMicros: 0n,
    gasUsdMicros: 0n,
  };
  const realizedUsdMicros = at.realized;
  await rig.test.positions.record({ execution, positions: [], realizedUsdMicros }, live());
}

function fill(n: number, order: number, row: Partial<OrderFillRecord>): OrderFillRecord {
  const outcome = row.reason === undefined ? "filled" : "skipped";
  return { id: fixtureId("fil", n), orderId: fixtureId("ord", order), outcome, atMs: 0, ...row };
}

// The auto orders of the day: three active, their fills and skips, and one fill the day before.
async function ordersOfTheDay(rig: DayRig, fromMs: number): Promise<void> {
  const { stores } = rig.test;
  const subject = { store: stores.orders, intents: stores.intents, agents: stores.agents };
  const pair = { agentId: testAgent, walletId: testWallet };
  const other = pair;
  for (const n of [1, 2, 3]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one order at a time, in order
    await activeOrder({ ...subject, ...pair, other }, n);
  }
  const rows = [
    fill(1, 1, { atMs: fromMs - hourMs }),
    fill(2, 1, { atMs: fromMs + 2 * hourMs }),
    fill(3, 2, { atMs: fromMs + 5 * hourMs }),
    fill(4, 3, { atMs: fromMs + 9 * hourMs }),
    fill(5, 2, { atMs: fromMs + 10 * hourMs, reason: "nothing_to_sell" }),
    fill(6, 2, { atMs: fromMs + 11 * hourMs, reason: "nothing_to_sell" }),
    fill(7, 3, { atMs: fromMs + 20 * hourMs, reason: "daily_cap" }),
  ];
  for (const row of rows) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    await stores.orders.recordFill(row, live());
  }
}

// What waits for the owner: an open card, the agent's question, a looser per-trade cap.
async function waitsOfTheDay(rig: DayRig, nowMs: number): Promise<void> {
  const { stores, engine } = rig.test;
  const pair = { agentId: testAgent, walletId: testWallet };
  await stores.intents.create(intentDraft(pair, 9), live());
  const opened = { ...intentMove(9, 0, "awaiting_confirmation"), openCard: cardOf(9, 1) };
  await stores.intents.transition(opened, live());
  await stores.questions.ask(
    {
      id: fixtureId("qst", 1),
      agentId: testAgent,
      sessionId: fixtureId("ses", 1),
      turnId: fixtureId("trn", 1),
      text: "Sell the rest of the token?",
      choices: ["Yes", "No"],
      ref: "questionref0001x",
      state: "open",
      createdAtMs: nowMs - hourMs,
      closesAtMs: nowMs + hourMs,
    },
    live(),
  );
  const changes = { perTradeUsdMicros: testLimits.perTradeUsdMicros * 2n };
  await engine.handlers["limit/set"](testCall({ agent: testAgent, changes }));
}

// The model calls of the day: $1.20 in the 24 hours, $2.00 before them.
async function spendOfTheDay(rig: DayRig, fromMs: number): Promise<void> {
  const { modelUsage } = rig.test.stores;
  const turn = fixtureId("trn", 2);
  const calls = [
    { n: 1, atMs: fromMs - hourMs, usdMicros: 2_000_000n },
    { n: 2, atMs: fromMs + 3 * hourMs, usdMicros: 700_000n },
    { n: 3, atMs: fromMs + 15 * hourMs, usdMicros: 500_000n },
  ];
  for (const call of calls) {
    const charge = {
      agent: testAgent,
      turn,
      key: `${turn}.usage.${String(call.n)}`,
      model: "provider/model",
      inputTokens: 1_000,
      outputTokens: 100,
      cachedTokens: 0,
      ...call,
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    await modelUsage.record(charge, live());
  }
}

/**
 * The fixture day of agent `main`, the 24 hours before 2027-01-16 09:00 in Asia/Shanghai:
 *
 * - yesterday's summary read $1,150.00 live and $612.40 paper, at 09:00:30 on 2027-01-15;
 * - live: two coins on chain, $1,200.00 at $600, and one sale that realized $12.40; a sale the
 *   day before realized $99.00, which the day leaves out;
 * - paper: the one coin of the paper portfolio, $600.00, and one paper sale that lost $3.10;
 * - auto orders: three active, three fills and three skips in the day (two for too little of the
 *   token, one over the 24-hour cap), and one fill the day before;
 * - model spend: $0.70 and $0.50 in the day, $2.00 the day before, against the $5.00 budget;
 * - waiting for the owner: one card, the agent's question, a looser per-trade cap, and the
 *   wallet a stuck transaction holds.
 */
export async function fixtureDay(rig: DayRig): Promise<void> {
  const nowMs = rig.clock.now();
  const fromMs = nowMs - 24 * hourMs;
  const before = {
    agentId: testAgent,
    date: "2027-01-15",
    atMs: nowMs - 24 * hourMs + 30_000,
    outcome: "sent",
    liveUsdMicros: 1_150_000_000n,
    paperUsdMicros: 612_400_000n,
  } as const;
  await rig.test.stores.dailySummaries.claim(before, live());
  await trade(rig, { n: 1, atMs: fromMs - 2 * hourMs, isPaper: false, realized: 99_000_000n });
  await trade(rig, { n: 2, atMs: fromMs + 4 * hourMs, isPaper: false, realized: 12_400_000n });
  await trade(rig, { n: 3, atMs: fromMs + 6 * hourMs, isPaper: true, realized: -3_100_000n });
  await ordersOfTheDay(rig, fromMs);
  await waitsOfTheDay(rig, nowMs);
  await spendOfTheDay(rig, fromMs);
  rig.hold({ agent: testAgent, account: testAccount });
}
