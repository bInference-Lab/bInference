import { bpsSchema } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { inOrder } from "../contracts/store-fixtures.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { testLimits, testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import { copyDayMs } from "./copy-state.js";
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

/** What happens between two looks at the order: a leader trade, time, a run, a restart. */
type Step =
  | { readonly kind: "buy"; readonly paidMilli: number; readonly runsNow: boolean }
  | { readonly kind: "sell"; readonly shareBps?: number }
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "run" }
  | { readonly kind: "restart" };

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
  {
    arbitrary: fc
      .constantFrom(1_000, 30_000, 61_000, 3_600_000, 43_200_000)
      .map((ms) => ({ kind: "wait" as const, ms })),
    weight: 3,
  },
  { arbitrary: fc.constant({ kind: "run" as const }), weight: 4 },
  { arbitrary: fc.constant({ kind: "restart" as const }), weight: 1 },
);

/** The order's dollars per buy and a day, and the agent's copy limits, in whole dollars. */
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
 * Drives one test's engine through steps; a restart swaps in a new one on the same stores. A buy
 * run at once, with no other trade waiting, records what it filled beside the leader's own buy.
 */
function driverOf(test: TestEngine): {
  readonly take: (step: Step) => Promise<void>;
  readonly atOnce: readonly BuyAtOnce[];
} {
  const atOnce: BuyAtOnce[] = [];
  let engine = test.engine;
  let block = 0;
  // The leader trades stored since the last run.
  let waiting = 0;
  const buysNow = async () => (await fillIntentsOf(test)).filter(isFilledBuy);
  const take = async (step: Step): Promise<void> => {
    block += 1;
    const atMs = test.clock.now();
    if (step.kind === "buy") {
      const coinBase = BigInt(step.paidMilli) * 10n ** 15n;
      await storeTrades(test, [leaderTrade(block, { side: "buy", atMs, coinBase })]);
      waiting += 1;
      if (step.runsNow) {
        const isAlone = waiting === 1;
        waiting = 0;
        const before = new Set((await buysNow()).map(({ id }) => id));
        await engine.runCopies(live);
        const added = (await buysNow()).filter(({ id }) => !before.has(id));
        const leaderUsdMicros = coinMilliUsd(step.paidMilli);
        const filled = isAlone ? added : [];
        atOnce.push(...filled.map(({ valueUsdMicros }) => ({ valueUsdMicros, leaderUsdMicros })));
      }
    } else if (step.kind === "sell") {
      const share =
        step.shareBps === undefined ? {} : { shareSoldBps: bpsSchema.parse(step.shareBps) };
      await storeTrades(test, [leaderTrade(block, { side: "sell", atMs, ...share })]);
      waiting += 1;
    } else if (step.kind === "wait") {
      await test.clock.advance(step.ms);
    } else if (step.kind === "run") {
      waiting = 0;
      await engine.runCopies(live);
    } else {
      engine = test.restart();
      await engine.repairOrderFills(live);
    }
  };
  return { take, atOnce };
}

// A buy valued above the leader's own buy, or not valued at all.
const isOverLeader = (buy: BuyAtOnce): boolean =>
  buy.valueUsdMicros === undefined || buy.valueUsdMicros > buy.leaderUsdMicros;

const isFilledBuy = (intent: IntentRecord): boolean =>
  intent.kind === "buy" && intent.state === "paper_filled";

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

/** The order's and the agent's dollars, as drawn. */
interface Terms {
  readonly perBuy: number;
  readonly days: number;
  readonly agentPerBuy: number;
  readonly agentDay: number;
}

const isTrade = (step: Step): boolean => step.kind === "buy" || step.kind === "sell";
const leastOf = (left: bigint, right: bigint): bigint => (left < right ? left : right);
// A buy valued above its most, or not valued at all.
const isOver = (buy: IntentRecord, most: bigint): boolean =>
  buy.valueUsdMicros === undefined || buy.valueUsdMicros > most;

describe("a copy order, for every history of leader trades, waits, runs and restarts", () => {
  it("never buys over its caps or the leader's own buy, never sells more than it bought, never skips a sale as late, and copies each trade once", async () => {
    const histories = fc.tuple(terms, fc.array(steps, { minLength: 4, maxLength: 24 }));
    const seen = { buys: 0, sales: 0, skips: 0, atOnce: 0 };
    await fc.assert(
      fc.asyncProperty(histories, async (drawn: readonly [Terms, readonly Step[]]) => {
        const [given, history] = drawn;
        const limits = {
          ...testLimits,
          copyPerBuyUsdMicros: BigInt(given.agentPerBuy) * dollar,
          copyPerLeaderDayUsdMicros: BigInt(given.agentDay) * dollar,
        };
        const test = await startFillEngine({ prices, agent: { limits } });
        const perBuy = BigInt(given.perBuy) * dollar;
        const trigger = {
          ...testCopy().trigger,
          perBuyUsdMicros: perBuy,
          dailyUsdMicros: perBuy * BigInt(given.days),
        };
        const order = await activeOrder(test, testCopy({ size: { usdMicros: perBuy }, trigger }));
        const driver = driverOf(test);
        await inOrder(history, driver.take);

        const fills = (await fillIntentsOf(test)).filter(({ state }) => state === "paper_filled");
        const buys = fills.filter(({ kind }) => kind === "buy");
        const rows = await fillRowsOf(test, order.id);
        const trades = history.filter(isTrade).length;
        const most = leastOf(perBuy, limits.copyPerBuyUsdMicros);
        seen.buys += buys.length;
        seen.sales += fills.length - buys.length;
        seen.skips += rows.length - fills.length;
        seen.atOnce += driver.atOnce.length;

        expect(buys.filter((buy) => isOver(buy, most))).toStrictEqual([]);
        // A buy never spends more than the leader's own (the owner's choice, decision 0260).
        const overLeader = driver.atOnce.filter(isOverLeader);
        expect(overLeader).toStrictEqual([]);
        expect(isWithinDays(buys, trigger.dailyUsdMicros)).toBe(true);
        expect(isWithinDays(buys, limits.copyPerLeaderDayUsdMicros)).toBe(true);
        expect(isWithinHeld(inFillOrder(test, fills))).toBe(true);
        expect(rows.length).toBeLessThanOrEqual(trades);
        // Only a buy is ever skipped as late: a late sale still sells (decision 0260).
        const lateRows = rows.filter(({ reason }) => reason === "late").length;
        expect(lateRows).toBeLessThanOrEqual(history.filter(({ kind }) => kind === "buy").length);
      }),
      { numRuns: 40 },
    );
    // The histories bought, sold and skipped, so the property held over fills, not over nothing.
    const held = [seen.buys, seen.sales, seen.skips, seen.atOnce].map((count) => count > 0);
    expect(held).toStrictEqual([true, true, true, true]);
  });
});
