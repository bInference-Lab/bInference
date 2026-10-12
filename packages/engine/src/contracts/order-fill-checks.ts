import assert from "node:assert/strict";
import type { OrderFillRecord } from "../orders/order-fill.js";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import { confirmedCard, orderDraft, orderMove, type OrderStoreSubject } from "./order-fixtures.js";
import { assertRefusesAborted, fixtureId, live } from "./store-fixtures.js";

/** Fill row `n` of order `order`: a skip with the policy's reason at `1000 * n`, or a fill. */
function fillRow(order: number, n: number, outcome: OrderFillRecord["outcome"]): OrderFillRecord {
  return {
    id: fixtureId("fil", n),
    orderId: fixtureId("ord", order),
    outcome,
    ...(outcome === "skipped" ? { reason: "per_trade_cap" } : {}),
    atMs: 1_000 * n,
  };
}

/** Order `n`, created and moved to `active` on its confirmed card. */
async function activeOrder(subject: OrderStoreSubject, n: number): Promise<void> {
  const { store } = subject;
  const card = await confirmedCard(subject, n);
  assert.ok((await store.create(orderDraft(subject, n), live())).ok);
  assert.ok((await store.move([{ ...orderMove(n, 0, "active"), cardId: card }], live())).ok);
}

/**
 * Checks that an order's skips are stored with their reasons and intents and listed newest first,
 * and that a row naming an unknown order or intent, or an id in use, is refused.
 */
export async function recordsSkips(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  assert.ok((await store.create(orderDraft(subject, 1), live())).ok);
  assert.ok((await intents.create(intentDraft(subject, 5), live())).ok);
  const first = fillRow(1, 2, "skipped");
  const second = { ...fillRow(1, 3, "skipped"), intentId: fixtureId("int", 5) };
  const third = {
    ...fillRow(1, 4, "skipped"),
    reason: "copy_daily_cap" as const,
    atMs: second.atMs,
  };
  assert.deepEqual(await store.recordFill(first, live()), first);
  assert.deepEqual(await store.recordFill(second, live()), second);
  assert.deepEqual(await store.recordFill(third, live()), third);
  const query = { orderId: fixtureId("ord", 1), limit: 10 };
  assert.deepEqual(await store.fills(query, live()), [third, second, first]);
  assert.deepEqual(await store.fills({ ...query, limit: 1 }, live()), [third]);
  assert.deepEqual(await store.fills({ ...query, orderId: fixtureId("ord", 2) }, live()), []);
  await assert.rejects(store.recordFill(first, live()), { code: "store.constraint" });
  const strayOrder = { ...fillRow(9, 6, "skipped") };
  await assert.rejects(store.recordFill(strayOrder, live()), { code: "store.constraint" });
  const strayIntent = { ...fillRow(1, 7, "skipped"), intentId: fixtureId("int", 9) };
  await assert.rejects(store.recordFill(strayIntent, live()), { code: "store.constraint" });
  assert.equal((await store.fills(query, live())).length, 3);
}

/**
 * Checks that a fill's order moves and row land with its intent's move, all or nothing: an order
 * at another version leaves the intent, the orders and the rows as they were.
 */
export async function writesAFillWithItsIntent(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeOrder(subject, 1);
  await activeOrder(subject, 2);
  assert.ok((await intents.create(intentDraft(subject, 3), live())).ok);
  const filled = { ...orderMove(1, 1, "filled"), fills: 1 };
  const ended = { ...orderMove(2, 1, "ended"), endReason: "position_closed" } as const;
  const fill = { ...fillRow(1, 8, "filled"), intentId: fixtureId("int", 3) };
  const stale = { ...intentMove(3, 0, "checked"), order: { moves: [filled, ended], fill } };
  const behind = { ...stale, order: { moves: [{ ...filled, expectedVersion: 0 }], fill } };
  assert.deepEqual(await intents.transition(behind, live()), { ok: false, error: "stale" });
  assert.equal((await intents.get(fixtureId("int", 3), live()))?.version, 0);
  assert.equal((await store.get(fixtureId("ord", 1), live()))?.state, "active");
  assert.deepEqual(await store.fills({ orderId: fixtureId("ord", 1), limit: 5 }, live()), []);
  const moved = await intents.transition(stale, live());
  assert.ok(moved.ok);
  assert.deepEqual(
    moved.value.orders?.map(({ id, state, fills, endReason }) => ({ id, state, fills, endReason })),
    [
      { id: fixtureId("ord", 1), state: "filled", fills: 1, endReason: undefined },
      { id: fixtureId("ord", 2), state: "ended", fills: 0, endReason: "position_closed" },
    ],
  );
  assert.equal(moved.value.intent.state, "checked");
  assert.deepEqual(await store.fills({ orderId: fixtureId("ord", 1), limit: 5 }, live()), [fill]);
}

/** Checks that the fill calls refuse an aborted signal and write nothing. */
export async function refusesAbortedFills(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  assert.ok((await store.create(orderDraft(subject, 1), live())).ok);
  const row = fillRow(1, 2, "skipped");
  await assertRefusesAborted(async (options) => store.recordFill(row, options));
  const query = { orderId: fixtureId("ord", 1), limit: 5 };
  await assertRefusesAborted(async (options) => store.fills(query, options));
  assert.deepEqual(await store.fills(query, live()), []);
}
