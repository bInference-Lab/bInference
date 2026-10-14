import assert from "node:assert/strict";
import type { IntentDraft } from "../intents/intent-record.js";
import type { OrderFillRecord } from "../orders/order-fill.js";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import { confirmedCard, orderDraft, orderMove, type OrderStoreSubject } from "./order-fixtures.js";
import { assertRefusesAborted, fixtureId, live } from "./store-fixtures.js";

/** Fill row `n` of order `order`: a skip with the policy's reason at `1000 * n`, or a fill. */
export function fillRow(
  order: number,
  n: number,
  outcome: OrderFillRecord["outcome"],
): OrderFillRecord {
  return {
    id: fixtureId("fil", n),
    orderId: fixtureId("ord", order),
    outcome,
    ...(outcome === "skipped" ? { reason: "per_trade_cap" } : {}),
    atMs: 1_000 * n,
  };
}

/** Order `n`, created and moved to `active` on its confirmed card. */
export async function activeOrder(subject: OrderStoreSubject, n: number): Promise<void> {
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

/**
 * Checks that a `filled` row lands only with its own order's move to one fill more (decision
 * 0197): a write that only ends other orders, or counts the fill wrong, is refused and leaves the
 * intent, the orders and the rows as they were.
 */
export async function refusesAFillWithoutItsOrderMove(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeOrder(subject, 1);
  await activeOrder(subject, 2);
  assert.ok((await intents.create(intentDraft(subject, 3), live())).ok);
  const ended = { ...orderMove(2, 1, "ended"), endReason: "position_closed" } as const;
  const fill = { ...fillRow(1, 8, "filled"), intentId: fixtureId("int", 3) };
  const move = intentMove(3, 0, "checked");
  const withoutOwn = { ...move, order: { moves: [ended], fill } };
  const counted = { ...move, order: { moves: [{ ...orderMove(1, 1, "filled"), fills: 2 }], fill } };
  await assert.rejects(intents.transition(withoutOwn, live()), { code: "store.constraint" });
  await assert.rejects(intents.transition(counted, live()), { code: "store.constraint" });
  assert.equal((await intents.get(fixtureId("int", 3), live()))?.version, 0);
  assert.equal((await store.get(fixtureId("ord", 2), live()))?.state, "active");
  assert.equal((await store.get(fixtureId("ord", 1), live()))?.fills, 0);
  assert.deepEqual(await store.fills({ orderId: fixtureId("ord", 1), limit: 5 }, live()), []);
}

/**
 * Checks that a landed live fill counts on its order apart from its intent's move, once per intent
 * (decision 0211): an order at another version, or an intent counted already, writes nothing, and
 * no second `filled` row of one intent lands by any write.
 */
export async function countsALandedFillOnce(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeOrder(subject, 1);
  assert.ok((await intents.create(intentDraft(subject, 3), live())).ok);
  const counted = { ...orderMove(1, 1, "active"), fills: 1 };
  const fill = { ...fillRow(1, 8, "filled"), intentId: fixtureId("int", 3) };
  const behind = { moves: [{ ...counted, expectedVersion: 0 }], fill };
  assert.deepEqual(await store.recordLandedFill(behind, live()), { ok: false, error: "stale" });
  const landed = await store.recordLandedFill({ moves: [counted], fill }, live());
  assert.ok(landed.ok);
  assert.deepEqual(
    landed.value.map(({ fills, version }) => ({ fills, version })),
    [{ fills: 1, version: 2 }],
  );
  const again = {
    moves: [{ ...counted, expectedVersion: 2, fills: 2 }],
    fill: { ...fill, id: fixtureId("fil", 9) },
  };
  assert.deepEqual(await store.recordLandedFill(again, live()), { ok: false, error: "counted" });
  await assert.rejects(store.recordFill(again.fill, live()), { code: "store.constraint" });
  assert.deepEqual(await store.countedFill(fixtureId("int", 3), live()), fill);
  assert.equal(await store.countedFill(fixtureId("int", 4), live()), undefined);
  const skip = { ...fillRow(1, 10, "skipped"), intentId: fixtureId("int", 3) };
  await assert.rejects(store.recordLandedFill({ moves: [], fill: skip }, live()), {
    code: "store.constraint",
  });
  assert.equal((await store.get(fixtureId("ord", 1), live()))?.fills, 1);
  assert.deepEqual(await store.fills({ orderId: fixtureId("ord", 1), limit: 5 }, live()), [fill]);
  await assertRefusesAborted(async (options) => store.recordLandedFill(again, options));
}

/**
 * Checks that a late landing carries its fill on its order in the same write (decision 0211): an
 * order at another version links nothing and counts nothing, and a second landing of one intent
 * counts nothing more.
 */
export async function linksALateLandingWithItsFill(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeOrder(subject, 1);
  assert.ok((await intents.create(intentDraft(subject, 3), live())).ok);
  const counted = { ...orderMove(1, 1, "filled"), fills: 1 };
  const fill = { ...fillRow(1, 8, "filled"), intentId: fixtureId("int", 3) };
  const landing = { intentId: fixtureId("int", 3), txId: fixtureId("tx", 1), atMs: 9_000 };
  const behind = { ...landing, order: { moves: [{ ...counted, expectedVersion: 0 }], fill } };
  assert.deepEqual(await intents.recordLandedLate(behind, live()), { ok: false, error: "stale" });
  assert.equal((await store.get(fixtureId("ord", 1), live()))?.fills, 0);
  const linked = { ...landing, order: { moves: [counted], fill } };
  assert.deepEqual(await intents.recordLandedLate(linked, live()), { ok: true, value: linked });
  const again = {
    ...linked,
    order: { moves: [{ ...counted, expectedVersion: 2, fills: 2 }], fill },
  };
  assert.deepEqual(await intents.recordLandedLate(again, live()), { ok: false, error: "exists" });
  assert.deepEqual(
    await store.get(fixtureId("ord", 1), live()).then((order) => [order?.state, order?.fills]),
    ["filled", 1],
  );
  assert.deepEqual(await store.fills({ orderId: fixtureId("ord", 1), limit: 5 }, live()), [fill]);
}

// Intent `n`: a live fill the engine proposed under order 1, stored in `state` at `1000 * n`.
function liveFill(
  subject: OrderStoreSubject,
  n: number,
  changes: Partial<IntentDraft> = {},
): IntentDraft {
  return {
    ...intentDraft(subject, n),
    isPaper: false,
    proposer: "engine",
    authorizedBy: { order: fixtureId("ord", 1), fillsBefore: 0 },
    state: "executing",
    ...changes,
  };
}

/**
 * Checks that every live order fill holding its agent's line is listed, past any page size
 * (decision 0211): one the executor holds and its order has not counted, and one ended
 * `stuck_dropped` since the query's time with no late landing; no paper, tapped, auto-mode,
 * counted, settled, earlier dropped or late-landed intent.
 */
export async function listsTheFillsInFlight(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeOrder(subject, 1);
  const dropped = { state: "failed_onchain", reason: "stuck_dropped" } as const;
  const drafts = [
    liveFill(subject, 3),
    liveFill(subject, 4, { state: "confirmed" }),
    liveFill(subject, 5, dropped),
    liveFill(subject, 6, { ...dropped, atMs: 3_000 }),
    liveFill(subject, 7, dropped),
    liveFill(subject, 8, { isPaper: true }),
    liveFill(subject, 9, { proposer: fixtureId("tok", 1) }),
    liveFill(subject, 10, { authorizedBy: { approvalMode: "auto", modeVersion: 1 } }),
    liveFill(subject, 11, { state: "reconciled" }),
    ...Array.from({ length: 120 }, (_, index) => liveFill(subject, 100 + index)),
  ];
  // One at a time, so each draft is stored in order.
  await drafts.reduce(async (before, draft) => {
    await before;
    assert.ok((await intents.create(draft, live())).ok);
  }, Promise.resolve());
  const counted = { ...fillRow(1, 2, "filled"), intentId: fixtureId("int", 4) };
  await store.recordFill(counted, live());
  const landing = { intentId: fixtureId("int", 7), txId: fixtureId("tx", 1), atMs: 7_500 };
  assert.ok((await intents.recordLandedLate(landing, live())).ok);
  const query = { agentId: subject.agentId, droppedSinceMs: 4_000 };
  const listed = await intents.fillsInFlight(query, live());
  const extra = drafts.slice(9).map(({ id }) => id);
  assert.deepEqual(
    listed.map(({ id }) => id),
    [fixtureId("int", 3), fixtureId("int", 5), ...extra],
  );
  await assertRefusesAborted(async (options) => intents.fillsInFlight(query, options));
}

/**
 * Checks that a row keeps its notices and lists as unannounced, the oldest first, until it is
 * marked announced, which keeps the first time; a row without notices, or an unknown one, is
 * refused and marks nothing.
 */
export async function announcesFillNotices(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  assert.ok((await store.create(orderDraft(subject, 1), live())).ok);
  assert.ok((await store.create(orderDraft(subject, 2), live())).ok);
  const notices = [{ key: "notice.skipped", values: { amount: "18446744073709551617" } }];
  const late = { ...fillRow(1, 5, "skipped"), notices };
  const early = { ...fillRow(2, 3, "skipped"), notices };
  const quiet = fillRow(1, 4, "skipped");
  assert.deepEqual(await store.recordFill(late, live()), late);
  assert.deepEqual(await store.recordFill(early, live()), early);
  assert.deepEqual(await store.recordFill(quiet, live()), quiet);
  assert.deepEqual(await store.unannounced({ limit: 10 }, live()), [early, late]);
  assert.deepEqual(await store.unannounced({ limit: 1 }, live()), [early]);
  await assert.rejects(store.markAnnounced({ ids: [early.id, quiet.id], atMs: 7 }, live()), {
    code: "store.constraint",
  });
  await assert.rejects(
    store.markAnnounced({ ids: [early.id, fixtureId("fil", 9)], atMs: 7 }, live()),
    { code: "store.constraint" },
  );
  assert.equal((await store.unannounced({ limit: 10 }, live())).length, 2);
  await store.markAnnounced({ ids: [early.id], atMs: 7 }, live());
  await store.markAnnounced({ ids: [early.id, late.id], atMs: 9 }, live());
  assert.deepEqual(await store.unannounced({ limit: 10 }, live()), []);
  const query = { orderId: fixtureId("ord", 2), limit: 5 };
  assert.deepEqual(await store.fills(query, live()), [{ ...early, announcedAtMs: 7 }]);
  await assertRefusesAborted(async (options) => store.unannounced({ limit: 5 }, options));
  await assertRefusesAborted(async (options) =>
    store.markAnnounced({ ids: [late.id], atMs: 11 }, options),
  );
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
