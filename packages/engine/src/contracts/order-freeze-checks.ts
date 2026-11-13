import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { FreezeWrite } from "../intents/freeze-write.js";
import { breakerWrite } from "./breaker-freeze-checks.js";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import {
  agentVersion,
  confirmedCard,
  orderDraft,
  orderMove,
  type OrderStoreSubject,
} from "./order-fixtures.js";
import { checkOn, fixtureId, live } from "./store-fixtures.js";

/** Order 1, created and moved to `active` on its confirmed card. */
async function activeOrder(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  const card = await confirmedCard(subject, 1);
  await store.create(orderDraft(subject, 1), live());
  assert.ok((await store.move([{ ...orderMove(1, 0, "active"), cardId: card }], live())).ok);
}

/** A freeze or an unfreeze of the subject's agent that moves orders and nothing else. */
async function freezeOf(
  subject: OrderStoreSubject,
  change: Pick<FreezeWrite, "isFrozen" | "orders" | "atMs">,
): Promise<FreezeWrite> {
  const expectedVersion = await agentVersion(subject, subject.agentId);
  return {
    ...change,
    agents: [{ agentId: subject.agentId, expectedVersion }],
    isWholeInstall: false,
    moves: [],
    ledger: [],
  };
}

// Checks that an order is active only once its `autoOrder` intent holds its card's confirmation.
async function activatesOnTheConfirmedCard(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  await store.create(orderDraft(subject, 1), live());
  const unconfirmed = { ...orderMove(1, 0, "active"), cardId: fixtureId("crd", 11) };
  assert.deepEqual(await store.move([unconfirmed], live()), {
    ok: false,
    error: "not_confirmed",
  });
  assert.deepEqual(await store.move([orderMove(1, 0, "active")], live()), {
    ok: false,
    error: "not_confirmed",
  });
  const card = await confirmedCard(subject, 1);
  const otherCard = { ...orderMove(1, 0, "active"), cardId: fixtureId("crd", 12) };
  assert.deepEqual(await store.move([otherCard], live()), { ok: false, error: "not_confirmed" });
  const moved = await store.move([{ ...orderMove(1, 0, "active"), cardId: card }], live());
  assert.ok(moved.ok);
  assert.deepEqual(
    moved.value.map(({ state, cardId }) => ({ state, cardId })),
    [{ state: "active", cardId: card }],
  );
}

// Checks that a frozen agent's order never moves into `active` outside an unfreeze.
async function refusesAnActiveOrderOfAFrozenAgent(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  const card = await confirmedCard(subject, 1);
  await store.create(orderDraft(subject, 1), live());
  const frozen = await freezeOf(subject, { atMs: 2_000, isFrozen: true, orders: [] });
  assert.ok((await intents.freeze(frozen, live())).ok);
  const activation = { ...orderMove(1, 0, "active"), cardId: card };
  assert.deepEqual(await store.move([activation], live()), { ok: false, error: "frozen" });
  assert.deepEqual(await store.create(orderDraft(subject, 2), live()), {
    ok: false,
    error: "frozen",
  });
  assert.equal((await store.get(fixtureId("ord", 1), live()))?.state, "awaiting_confirmation");
}

// Checks that a freeze pauses its agent's orders in its own write, an unfreeze resumes them, and a
// resume of an agent that stays frozen is refused with the whole write.
async function freezesAndUnfreezesOrders(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeOrder(subject);
  const paused = await freezeOf(subject, {
    atMs: 2_000,
    isFrozen: true,
    orders: [orderMove(1, 1, "paused")],
  });
  const frozen = await intents.freeze(paused, live());
  assert.ok(frozen.ok);
  assert.deepEqual(
    frozen.value.orders.map(({ id, state, version }) => ({ id, state, version })),
    [{ id: fixtureId("ord", 1), state: "paused", version: 2 }],
  );
  const resumeOnly = { ...orderMove(1, 2, "active"), atMs: 3_000 };
  assert.deepEqual(await store.move([resumeOnly], live()), { ok: false, error: "frozen" });
  const stays = { ...(await freezeOf(subject, { atMs: 3_000, isFrozen: false, orders: [] })) };
  const elsewhere = { ...stays, agents: [], orders: [resumeOnly] };
  assert.deepEqual(await intents.freeze(elsewhere, live()), { ok: false, error: "stale" });
  const resumed = await intents.freeze({ ...stays, orders: [resumeOnly] }, live());
  assert.ok(resumed.ok);
  assert.deepEqual(
    resumed.value.orders.map(({ state, version }) => ({ state, version })),
    [{ state: "active", version: 3 }],
  );
  const agents = await subject.agents.list(live());
  assert.equal(agents.find(({ id }) => id === subject.agentId)?.frozenAtMs, undefined);
}

// While the breaker holds (decision 0440), no order activates or resumes, an owner's unfreeze
// included, and no order is made; the breaker's lift resumes it in its own write.
async function holdsOrdersWhileBraked(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeOrder(subject);
  const pull = breakerWrite(1, { atMs: 2_000, version: 1, isPulled: true });
  const paused = await intents.freeze({ ...pull, orders: [orderMove(1, 1, "paused")] }, live());
  assert.ok(paused.ok);
  assert.deepEqual(await store.create(orderDraft(subject, 2), live()), {
    ok: false,
    error: "frozen",
  });
  const resume = { ...orderMove(1, 2, "active"), atMs: 3_000 };
  const unfreeze = await freezeOf(subject, { atMs: 3_000, isFrozen: false, orders: [resume] });
  assert.deepEqual(await intents.freeze(unfreeze, live()), { ok: false, error: "stale" });
  assert.equal((await store.get(fixtureId("ord", 1), live()))?.state, "paused");
  // An owner's freeze planned before the lift, on the paused orders it read, is stale after it.
  const before = await freezeOf(subject, { atMs: 3_000, isFrozen: true, orders: [] });
  const lift = breakerWrite(2, { atMs: 3_000, version: 2, isPulled: false });
  const resumed = await intents.freeze({ ...lift, orders: [resume] }, live());
  assert.ok(resumed.ok);
  assert.equal((await store.get(fixtureId("ord", 1), live()))?.state, "active");
  assert.deepEqual(await intents.freeze(before, live()), { ok: false, error: "stale" });
}

/**
 * Checks that a freeze writes the skip row of a fill it cancels with the cancel itself (decision
 * 0197), beside the pause of the fill's order.
 */
export async function writesAFrozenFillsRow(subject: OrderStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeOrder(subject);
  assert.ok((await intents.create(intentDraft(subject, 3), live())).ok);
  const row = {
    id: fixtureId("fil", 4),
    orderId: fixtureId("ord", 1),
    intentId: fixtureId("int", 3),
    outcome: "skipped" as const,
    reason: "frozen" as const,
    atMs: 2_000,
  };
  const cancelled = { ...intentMove(3, 0, "cancelled"), order: { moves: [], fill: row } };
  const paused = await freezeOf(subject, {
    atMs: 2_000,
    isFrozen: true,
    orders: [orderMove(1, 1, "paused")],
  });
  assert.ok((await intents.freeze({ ...paused, moves: [cancelled] }, live())).ok);
  assert.deepEqual(await store.fills({ orderId: fixtureId("ord", 1), limit: 5 }, live()), [row]);
  assert.equal((await store.get(fixtureId("ord", 1), live()))?.state, "paused");
}

/**
 * The checks of how an `OrderStore` moves orders into `active`: only on the card's confirmation,
 * never for a frozen agent, and with a freeze and an unfreeze in their own write.
 */
export function orderFreezeChecks(
  create: () => Promise<OrderStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn(
      "activates an order only on its card's confirmation",
      create,
      activatesOnTheConfirmedCard,
    ),
    checkOn("never activates a frozen agent's order", create, refusesAnActiveOrderOfAFrozenAgent),
    checkOn(
      "pauses and resumes orders in the freeze's own write",
      create,
      freezesAndUnfreezesOrders,
    ),
    checkOn(
      "holds orders while the breaker holds and resumes them at its lift",
      create,
      holdsOrdersWhileBraked,
    ),
  ];
}
