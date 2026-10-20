import type { TxHash } from "@binference/chain";
import { bpsSchema, type Id } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { expectOk, testLimits, testToken } from "../intents/test-intents.js";
import type { StoredActivity, WalletActivity } from "../leaders/tracked-wallet-record.js";
import { type TestEngine, testCall } from "../operations/test-engine.js";
import { copyDayMs, copyStateOf } from "./copy-state.js";
import type { OrderFillRecord } from "./order-fill.js";
import type { OrderStore } from "./ports.js";
import { leaderTrade, storeTrades } from "./test-copies.js";
import {
  activeOrder,
  fillIntentsOf,
  fillPrices,
  fillRowsOf,
  startFillEngine,
} from "./test-fills.js";
import { testCopy } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const dollar = 1_000_000n;
// The fake venue pays two base units for one, so the token's price keeps a copy's sale small.
const prices = new Map(fillPrices).set(testToken, { numerator: 1n, denominator: 10n ** 9n });

/**
 * What happens between two looks at the orders: a leader trade, the last one stored again, time,
 * a run, a run a stop cuts off between its take and its fill, a restart, and a second copy order
 * on the same leader that starts and is cancelled.
 */
type Step =
  | { readonly kind: "buy"; readonly paidMilli: number; readonly runsNow: boolean }
  | { readonly kind: "sell"; readonly shareBps?: number }
  | { readonly kind: "again" }
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "run" }
  | { readonly kind: "cut" }
  | { readonly kind: "restart" }
  | { readonly kind: "second" }
  | { readonly kind: "endSecond" };

const steps: fc.Arbitrary<Step> = fc.oneof(
  {
    // The leader pays thousandths of the coin, $0.60 each, and the copy may run at once.
    arbitrary: fc.record({
      kind: fc.constant("buy" as const),
      paidMilli: fc.integer({ min: 1, max: 200 }),
      runsNow: fc.boolean(),
    }),
    weight: 4,
  },
  {
    arbitrary: fc
      .option(fc.integer({ min: 1, max: 10_000 }), { nil: undefined })
      .map((shareBps) =>
        shareBps === undefined ? { kind: "sell" as const } : { kind: "sell" as const, shareBps },
      ),
    weight: 2,
  },
  { arbitrary: fc.constant({ kind: "again" as const }), weight: 1 },
  {
    arbitrary: fc
      .constantFrom(1_000, 30_000, 61_000, 3_600_000, 43_200_000)
      .map((ms) => ({ kind: "wait" as const, ms })),
    weight: 3,
  },
  { arbitrary: fc.constant({ kind: "run" as const }), weight: 4 },
  { arbitrary: fc.constant({ kind: "cut" as const }), weight: 2 },
  { arbitrary: fc.constant({ kind: "restart" as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: "second" as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: "endSecond" as const }), weight: 1 },
);

/** The orders' dollars per buy and a day, and the agent's copy limits, in whole dollars. */
const terms = fc.record({
  perBuy: fc.integer({ min: 5, max: 30 }),
  days: fc.integer({ min: 1, max: 6 }),
  agentPerBuy: fc.integer({ min: 1, max: 30 }),
  agentDay: fc.integer({ min: 5, max: 120 }),
});

/** What a run right after a leader's buy filled: the buy's value and the leader's own buy's. */
interface BuyAtOnce {
  readonly valueUsdMicros: bigint | undefined;
  readonly leaderUsdMicros: bigint;
}

// The value of thousandths of the coin, at the coin's $600, rounded up as the policy rounds.
const coinMilliUsd = (milli: number): bigint => BigInt(milli) * 600_000n;

/**
 * Runs that a stop cuts off right after their next take is written, before that take's fill, over
 * the order store it wraps.
 */
interface Cutter {
  readonly orders: (store: OrderStore) => OrderStore;
  readonly run: (engine: Pick<TestEngine["engine"], "runCopies">) => Promise<void>;
}

function cutterOf(): Cutter {
  let armed: AbortController | undefined;
  return {
    orders: (inner) => ({
      ...inner,
      move: async (moves, options) => {
        const written = await inner.move(moves, options);
        const isTake = moves.some(({ triggerState }) => copyStateOf(triggerState)?.taking);
        if (armed !== undefined && written.ok && isTake) {
          armed.abort(new Error("The engine stopped."));
          armed = undefined;
        }
        return written;
      },
    }),
    run: async (engine) => {
      const controller = new AbortController();
      armed = controller;
      await engine.runCopies({ signal: controller.signal }).catch(() => undefined);
      armed = undefined;
    },
  };
}

/** A leader trade as stored, by its transaction and side. */
interface StoredTrade {
  readonly txHash: TxHash;
  readonly side: "buy" | "sell";
}

/** Where a history stands after a step: its engine, the trades stored, the second order. */
interface At {
  readonly engine: Pick<TestEngine["engine"], "runCopies" | "repairOrderFills">;
  readonly block: number;
  /** The leader trades stored since the last whole run. */
  readonly waiting: number;
  readonly last?: WalletActivity;
  readonly second?: { readonly id: Id<"ord">; readonly isEnded: boolean };
  /** The leader's trades by their stored numbers. */
  readonly trades: ReadonlyMap<number, StoredTrade>;
  readonly atOnce: readonly BuyAtOnce[];
}

/** What a history runs on: the test engine, the cut runs, the orders' terms. */
interface Bench {
  readonly test: TestEngine;
  readonly cutter: Cutter;
  readonly terms: Parameters<typeof testCopy>[0];
}

async function storedAt(bench: Bench, at: At, trades: readonly WalletActivity[]): Promise<At> {
  const stored: readonly StoredActivity[] = await storeTrades(bench.test, trades);
  const added = stored.map(({ id, txHash, side }) => [id, { txHash, side }] as const);
  const last = trades.at(-1);
  return {
    ...at,
    waiting: at.waiting + 1,
    trades: new Map([...at.trades, ...added]),
    ...(last === undefined ? {} : { last }),
  };
}

const isFilledBuy = (intent: IntentRecord): boolean =>
  intent.kind === "buy" && intent.state === "paper_filled";

// A buy run at once, with no other trade waiting, records what it filled beside the leader's own.
async function buy(bench: Bench, at: At, step: Extract<Step, { kind: "buy" }>): Promise<At> {
  const { test } = bench;
  const coinBase = BigInt(step.paidMilli) * 10n ** 15n;
  const trade = leaderTrade(at.block, { side: "buy", atMs: test.clock.now(), coinBase });
  const stored = await storedAt(bench, at, [trade]);
  if (!step.runsNow) {
    return stored;
  }
  const buysNow = async () => (await fillIntentsOf(test)).filter(isFilledBuy);
  const before = new Set((await buysNow()).map(({ id }) => id));
  await at.engine.runCopies(live);
  const isAlone = stored.waiting === 1;
  const added = isAlone ? (await buysNow()).filter(({ id }) => !before.has(id)) : [];
  const leaderUsdMicros = coinMilliUsd(step.paidMilli);
  const atOnce = added.map(({ valueUsdMicros }) => ({ valueUsdMicros, leaderUsdMicros }));
  return { ...stored, waiting: 0, atOnce: [...at.atOnce, ...atOnce] };
}

async function sell(bench: Bench, at: At, step: Extract<Step, { kind: "sell" }>): Promise<At> {
  const share = step.shareBps === undefined ? {} : { shareSoldBps: bpsSchema.parse(step.shareBps) };
  const atMs = bench.test.clock.now();
  return storedAt(bench, at, [leaderTrade(at.block, { side: "sell", atMs, ...share })]);
}

// The last trade stored again under another log index, as a reorganization may store it, in a
// read of its block that holds both.
async function again(bench: Bench, at: At): Promise<At> {
  const { last } = at;
  return last === undefined
    ? at
    : storedAt(bench, at, [last, { ...last, logIndex: last.logIndex + 1 }]);
}

// A new engine on the same stores, and its start's repairs.
async function restart(bench: Bench, at: At): Promise<At> {
  const engine = bench.test.restart();
  await engine.repairOrderFills(live);
  return { ...at, engine };
}

// A run a stop cuts off between a take and its fill, then the start after it.
async function cutRun(bench: Bench, at: At): Promise<At> {
  await bench.cutter.run(at.engine);
  return restart(bench, at);
}

// A second copy order on the same leader, with the first's terms, while none runs.
async function startSecond(bench: Bench, at: At): Promise<At> {
  if (at.second !== undefined) {
    return at;
  }
  await bench.test.clock.advance(1);
  const order = await activeOrder(bench.test, testCopy(bench.terms));
  return { ...at, second: { id: order.id, isEnded: false } };
}

async function endSecond(bench: Bench, at: At): Promise<At> {
  const { second } = at;
  if (second === undefined || second.isEnded) {
    return at;
  }
  const call = testCall({ order: second.id });
  expectOk(await bench.test.engine.handlers["order/cancel"](call));
  return { ...at, second: { ...second, isEnded: true } };
}

async function take(bench: Bench, before: At, step: Step): Promise<At> {
  const at = { ...before, block: before.block + 1 };
  switch (step.kind) {
    case "buy":
      return buy(bench, at, step);
    case "sell":
      return sell(bench, at, step);
    case "again":
      return again(bench, at);
    case "wait":
      await bench.test.clock.advance(step.ms);
      return at;
    case "run":
      await at.engine.runCopies(live);
      return { ...at, waiting: 0 };
    case "cut":
      return cutRun(bench, at);
    case "restart":
      return restart(bench, at);
    case "second":
      return startSecond(bench, at);
    case "endSecond":
      return endSecond(bench, at);
  }
  return at;
}

// A buy valued above the leader's own buy, or not valued at all.
const isOverLeader = (bought: BuyAtOnce): boolean =>
  bought.valueUsdMicros === undefined || bought.valueUsdMicros > bought.leaderUsdMicros;

/** What a copy fill moved of the token: bought out of a buy, sold into a sale. */
function tokenMoved(intent: IntentRecord): bigint {
  const quote = quoteDocument.decode(intent.quote ?? null);
  return intent.kind === "buy" ? quote.expectedOut.base : quote.amountIn.base;
}

/** Whether every 24-hour window holds the buys' values within a cap. */
function isWithinDays(buys: readonly IntentRecord[], capUsdMicros: bigint): boolean {
  return buys.every(({ changedAtMs: endMs }) => {
    const inDay = buys.filter(
      ({ changedAtMs }) => changedAtMs > endMs - copyDayMs && changedAtMs <= endMs,
    );
    return (
      inDay.reduce((sum, { valueUsdMicros }) => sum + (valueUsdMicros ?? 0n), 0n) <= capUsdMicros
    );
  });
}

/** The fills in the order they filled: the order of their `paper_filled` pushes. */
function inFillOrder(test: TestEngine, fills: readonly IntentRecord[]): readonly IntentRecord[] {
  const filledAt = new Map(
    test.pushes.flatMap((push, index) => {
      const data = push.data as { readonly intent?: string; readonly state?: string };
      return push.kind === "intent/changed" && data.state === "paper_filled"
        ? [[data.intent, index] as const]
        : [];
    }),
  );
  return fills.toSorted(
    (left, right) => (filledAt.get(left.id) ?? 0) - (filledAt.get(right.id) ?? 0),
  );
}

/** Whether no sale sold more of the token than the order's buys had bought before it. */
function isWithinHeld(ordered: readonly IntentRecord[]): boolean {
  const held = { base: 0n, isWithin: true };
  for (const fill of ordered) {
    const moved = tokenMoved(fill);
    if (fill.kind === "buy") {
      held.base += moved;
    } else {
      held.isWithin &&= moved <= held.base;
      held.base -= moved;
    }
  }
  return held.isWithin;
}

/** How many rows share each key, the keys that more than one share. */
function repeated(keys: readonly string[]): readonly string[] {
  return keys.filter((key, index) => keys.indexOf(key) !== index);
}

/** A row by the leader trade it names. */
interface LinkedRow extends StoredTrade {
  readonly id: number;
  readonly outcome: OrderFillRecord["outcome"];
  readonly reason: OrderFillRecord["reason"];
}

/** What one order's rows broke of the once-per-trade rules; empty when it kept them. */
function brokenOnce(at: At, rows: readonly OrderFillRecord[]): readonly string[] {
  const linked: readonly LinkedRow[] = rows.flatMap(({ copy, outcome, reason }) => {
    const trade = copy === undefined ? undefined : at.trades.get(copy.trade);
    return trade === undefined || copy === undefined
      ? []
      : [{ ...trade, id: copy.trade, outcome, reason }];
  });
  const filled = linked.filter(({ outcome }) => outcome === "filled");
  return [
    ...rows.filter(({ copy }) => copy === undefined).map(({ id }) => `unlinked ${id}`),
    ...repeated(filled.map(({ id }) => `filled twice: trade ${String(id)}`)),
    ...repeated(filled.map(({ txHash, side }) => `filled twice: ${side} in ${txHash}`)),
    ...repeated(
      linked.filter(({ side }) => side === "buy").map(({ id }) => `buy rows: ${String(id)}`),
    ),
    ...linked
      .filter(({ side, reason }) => side === "sell" && reason === "late")
      .map(({ id }) => `late sale ${String(id)}`),
  ];
}

/** The order's and the agent's dollars, as drawn. */
interface Terms {
  readonly perBuy: number;
  readonly days: number;
  readonly agentPerBuy: number;
  readonly agentDay: number;
}

const leastOf = (left: bigint, right: bigint): bigint => (left < right ? left : right);
// A buy valued above its most, or not valued at all.
const isOver = (bought: IntentRecord, most: bigint): boolean =>
  bought.valueUsdMicros === undefined || bought.valueUsdMicros > most;

/** One order's filled intents, by its filled rows. */
function fillsOf(
  rows: readonly OrderFillRecord[],
  intents: readonly IntentRecord[],
): readonly IntentRecord[] {
  const ids = new Set(
    rows.flatMap(({ outcome, intentId }) => (outcome === "filled" ? [intentId] : [])),
  );
  return intents.filter(({ id, state }) => state === "paper_filled" && ids.has(id));
}

/** What one history came to: its terms, and each order's rows, fills and buys. */
interface Outcome {
  readonly at: At;
  readonly test: TestEngine;
  readonly most: bigint;
  readonly dailyUsdMicros: bigint;
  readonly agentDayUsdMicros: bigint;
  readonly rowsOf: readonly (readonly OrderFillRecord[])[];
  readonly fillsOf: readonly (readonly IntentRecord[])[];
  readonly buysOf: readonly (readonly IntentRecord[])[];
}

// Runs one history on a new engine: the first copy order starts, then each step in turn.
async function outcomeOf(drawn: readonly [Terms, readonly Step[]]): Promise<Outcome> {
  const [given, history] = drawn;
  const limits = {
    ...testLimits,
    copyPerBuyUsdMicros: BigInt(given.agentPerBuy) * dollar,
    copyPerLeaderDayUsdMicros: BigInt(given.agentDay) * dollar,
  };
  const cutter = cutterOf();
  const test = await startFillEngine({ prices, agent: { limits }, orders: cutter.orders });
  const perBuy = BigInt(given.perBuy) * dollar;
  const dailyUsdMicros = perBuy * BigInt(given.days);
  const trigger = { ...testCopy().trigger, perBuyUsdMicros: perBuy, dailyUsdMicros };
  const orderTerms = { size: { usdMicros: perBuy }, trigger };
  const first = await activeOrder(test, testCopy(orderTerms));
  const bench = { test, cutter, terms: orderTerms };
  const start: At = { engine: test.engine, block: 0, waiting: 0, trades: new Map(), atOnce: [] };
  const at = await history.reduce(
    async (prior, step) => take(bench, await prior, step),
    Promise.resolve(start),
  );
  const intents = await fillIntentsOf(test);
  const orders = [first.id, ...(at.second === undefined ? [] : [at.second.id])];
  const rowsOf = await Promise.all(orders.map(async (id) => fillRowsOf(test, id)));
  const fills = rowsOf.map((rows) => fillsOf(rows, intents));
  const buysOf = fills.map((each) => each.filter(({ kind }) => kind === "buy"));
  const most = leastOf(perBuy, limits.copyPerBuyUsdMicros);
  const agentDayUsdMicros = limits.copyPerLeaderDayUsdMicros;
  return { at, test, most, dailyUsdMicros, agentDayUsdMicros, rowsOf, fillsOf: fills, buysOf };
}

describe("copy orders, for every history of leader trades, waits, runs, cut runs and restarts", () => {
  it("never buy over their caps or the leader's own buy, never sell more than they bought, never skip a sale as late, and copy each trade once", async () => {
    const histories = fc.tuple(terms, fc.array(steps, { minLength: 4, maxLength: 20 }));
    const seen = { buys: 0, sales: 0, skips: 0, atOnce: 0, missed: 0, seconds: 0, again: 0 };
    await fc.assert(
      fc.asyncProperty(histories, async (drawn: readonly [Terms, readonly Step[]]) => {
        const outcome = await outcomeOf(drawn);
        const { at, test, most, rowsOf, fillsOf: fills, buysOf } = outcome;
        const allBuys = buysOf.flat();
        const rows = rowsOf.flat();
        seen.buys += allBuys.length;
        seen.sales += fills.flat().length - allBuys.length;
        seen.skips += rows.filter(({ outcome: kind }) => kind === "skipped").length;
        seen.atOnce += at.atOnce.length;
        seen.missed += rows.filter(({ reason }) => reason === "missed").length;
        seen.seconds += rowsOf.length - 1;
        seen.again += drawn[1].filter(({ kind }) => kind === "again").length;

        expect(allBuys.filter((bought) => isOver(bought, most))).toStrictEqual([]);
        // A buy never spends more than the leader's own (the owner's choice, decision 0260).
        expect(at.atOnce.filter(isOverLeader)).toStrictEqual([]);
        const days = buysOf.map((buys) => isWithinDays(buys, outcome.dailyUsdMicros));
        expect(days).not.toContain(false);
        // The agent's day per leader counts every order's buys, an ended order's too.
        expect(isWithinDays(allBuys, outcome.agentDayUsdMicros)).toBe(true);
        const held = fills.map((each) => isWithinHeld(inFillOrder(test, each)));
        expect(held).not.toContain(false);
        // Each row names its leader trade: one fill a trade, one row a buy, no late sale.
        expect(rowsOf.flatMap((each) => brokenOnce(at, each))).toStrictEqual([]);
      }),
      { numRuns: 300 },
    );
    // The histories bought, sold, skipped, cut buys off, ran two orders and stored trades again,
    // so the property held over each of those, not over nothing.
    expect(Object.values(seen).map((count) => count > 0)).not.toContain(false);
  });
});
