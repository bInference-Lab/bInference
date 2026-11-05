import assert from "node:assert/strict";
import type { OrderFillRecord } from "../orders/order-fill.js";
import type { OrderMove } from "../orders/order-record.js";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import { activeOrder, fillRow } from "./order-fill-checks.js";
import { orderMove, type OrderStoreSubject } from "./order-fixtures.js";
import { fixtureId, inOrder, live } from "./store-fixtures.js";

// Each write that counts a fill on its order judges the order's version before its count: a write
// built from a version another fill moved on is `stale`, never a broken rule, so its writer reads
// the order again (decision 0211).

interface FillWrite {
  readonly moves: readonly OrderMove[];
  readonly fill: OrderFillRecord;
}

// Intent 3's fill counted on order 1 at version 1; answers intent 4's fill built from version 1,
// behind that move, and the same fill built from the order as it stands now.
async function behindAnotherFill(
  subject: OrderStoreSubject,
): Promise<{ readonly behind: FillWrite; readonly fresh: FillWrite }> {
  const { store, intents } = subject;
  await activeOrder(subject, 1);
  await inOrder([3, 4], async (n) => intents.create(intentDraft(subject, n), live()));
  const counted = { ...orderMove(1, 1, "active"), fills: 1 };
  const first = { ...fillRow(1, 8, "filled"), intentId: fixtureId("int", 3) };
  assert.ok((await store.recordLandedFill({ moves: [counted], fill: first }, live())).ok);
  const fill = { ...first, id: fixtureId("fil", 9), intentId: fixtureId("int", 4) };
  return {
    behind: { moves: [counted], fill },
    fresh: { moves: [{ ...orderMove(1, 2, "active"), fills: 2 }], fill },
  };
}

async function assertFills(subject: OrderStoreSubject, count: number): Promise<void> {
  const fills = await subject.store.fills({ orderId: fixtureId("ord", 1), limit: 5 }, live());
  assert.equal(fills.length, count);
  assert.equal((await subject.store.get(fixtureId("ord", 1), live()))?.fills, count);
}

/**
 * Checks that an intent's move carrying a fill built behind another fill's move on its order is
 * `stale` and writes nothing, and that the same fill built from the order read again lands.
 */
export async function answersAMoveBehindAnotherFillAsStale(
  subject: OrderStoreSubject,
): Promise<void> {
  const { behind, fresh } = await behindAnotherFill(subject);
  const move = intentMove(4, 0, "checked");
  const stale = await subject.intents.transition({ ...move, order: behind }, live());
  assert.deepEqual(stale, { ok: false, error: "stale" });
  assert.equal((await subject.intents.get(fixtureId("int", 4), live()))?.version, 0);
  await assertFills(subject, 1);
  assert.ok((await subject.intents.transition({ ...move, order: fresh }, live())).ok);
  await assertFills(subject, 2);
}

/**
 * Checks that a late landing carrying a fill built behind another fill's move on its order is
 * `stale` and links nothing, and that the same fill built from the order read again links.
 */
export async function answersALandingBehindAnotherFillAsStale(
  subject: OrderStoreSubject,
): Promise<void> {
  const { behind, fresh } = await behindAnotherFill(subject);
  const landing = { intentId: fixtureId("int", 4), txId: fixtureId("tx", 1), atMs: 9_000 };
  const stale = await subject.intents.recordLandedLate({ ...landing, order: behind }, live());
  assert.deepEqual(stale, { ok: false, error: "stale" });
  await assertFills(subject, 1);
  assert.ok((await subject.intents.recordLandedLate({ ...landing, order: fresh }, live())).ok);
  await assertFills(subject, 2);
}
