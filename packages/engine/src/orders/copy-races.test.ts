import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testToken } from "../intents/test-intents.js";
import type { TestEngine } from "../operations/test-engine.js";
import { copyStateOf } from "./copy-state.js";
import type { OrderMove } from "./order-record.js";
import { copyStateNow, leaderTrade, storeTrades } from "./test-copies.js";
import {
  activeOrder,
  fillIntentsOf,
  fillPrices,
  fillRowsOf,
  startFillEngine,
} from "./test-fills.js";
import { contendedOrders, testCopy } from "./test-orders.js";

const live = { signal: new AbortController().signal };
const prices = new Map(fillPrices).set(testToken, { numerator: 1n, denominator: 10n ** 9n });

// Picks the `n`th write that keeps an active copy order's state once armed, counting from one.
function nthKeep(
  n: number,
  armed: { readonly isOn: boolean },
): (moves: readonly OrderMove[]) => boolean {
  let seen = 0;
  return (moves) => {
    const isKeep = armed.isOn && moves.length === 1 && moves[0]?.state === "active";
    seen += isKeep ? 1 : 0;
    return isKeep && seen === n;
  };
}

// Picks a write that ends a copy order's take: its state took a trade and holds no take now.
function endsTake(moves: readonly OrderMove[]): boolean {
  const [move] = moves;
  const state = move?.state === "active" ? copyStateOf(move.triggerState) : undefined;
  return state !== undefined && state.takes > 0 && state.taking === undefined;
}

// The copy fills the engine filled so far, and their intents' kinds.
async function copiedOf(test: TestEngine, order: Parameters<typeof fillRowsOf>[1]) {
  const rows = await fillRowsOf(test, order);
  const intents = await fillIntentsOf(test);
  return {
    filled: rows.filter(({ outcome }) => outcome === "filled").length,
    intents: intents.map(({ kind, state }) => `${kind}:${state}`).toSorted(),
  };
}

// A copy order of a leader who bought, and sold half, where another write beats the order's
// `n`th write of its state: answers what the first run and three more copied.
async function racedCopies(n: number) {
  const armed = { isOn: false };
  const race = contendedOrders(1, nthKeep(n, armed));
  const test = await startFillEngine({ prices, orders: race.orders });
  const order = await activeOrder(test, testCopy());
  const atMs = test.clock.now();
  const share = bpsSchema.parse(5_000);
  await storeTrades(test, [
    leaderTrade(1, { side: "buy", atMs }),
    leaderTrade(2, { side: "sell", atMs, shareSoldBps: share }),
  ]);
  armed.isOn = true;
  await test.engine.runCopies(live);
  const first = await copiedOf(test, order.id);
  await test.engine.runCopies(live);
  await test.engine.runCopies(live);
  await test.engine.runCopies(live);
  return { raced: race.raced(), first, after: await copiedOf(test, order.id) };
}

describe("a copy order whose write another write beat", () => {
  it("copies the leader's buy once, on the next run, when the buy's take lost", async () => {
    const copied = await racedCopies(1);

    expect(copied).toStrictEqual({
      raced: 1,
      first: { filled: 0, intents: [] },
      after: { filled: 2, intents: ["buy:paper_filled", "sell:paper_filled"] },
    });
  });

  it("copies the leader's sale once, on the next run, when the sale's take lost", async () => {
    const copied = await racedCopies(2);

    expect(copied).toStrictEqual({
      raced: 1,
      first: { filled: 1, intents: ["buy:paper_filled"] },
      after: { filled: 2, intents: ["buy:paper_filled", "sell:paper_filled"] },
    });
  });

  it("ends a skipped buy's take once, on the next run, when the write ending it lost", async () => {
    const race = contendedOrders(1, endsTake);
    const lock = { isLocked: true };
    const isLocked = () => lock.isLocked;
    const test = await startFillEngine({ prices, orders: race.orders, isLocked });
    const order = await activeOrder(test, testCopy());
    await storeTrades(test, [leaderTrade(1, { side: "buy", atMs: test.clock.now() })]);

    await test.engine.runCopies(live);
    const first = await copyStateNow(test, order.id);
    lock.isLocked = false;
    await test.engine.runCopies(live);

    expect([race.raced(), first.taking?.id]).toStrictEqual([1, 1]);
    const after = await copyStateNow(test, order.id);
    expect([after.takes, after.taking]).toStrictEqual([1, undefined]);
    expect(await copiedOf(test, order.id)).toStrictEqual({ filled: 0, intents: [] });
    expect((await fillRowsOf(test, order.id)).map(({ reason }) => reason)).toStrictEqual([
      "engine_locked",
    ]);
  });
});
