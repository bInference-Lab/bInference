import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { orderDraft, orderMove, type OrderStoreSubject } from "./order-fixtures.js";
import { checkOn, live } from "./store-fixtures.js";

const within = (quota: number) => ({ ...live(), quota });

async function refusesAnOrderPastItsQuota(subject: OrderStoreSubject): Promise<void> {
  const { store, other } = subject;
  assert.ok((await store.create(orderDraft(subject, 1), within(2))).ok);
  assert.ok((await store.create(orderDraft(subject, 2), within(2))).ok);
  assert.deepEqual(await store.create(orderDraft(subject, 3), within(2)), {
    ok: false,
    error: "quota",
  });
  assert.equal(await store.get(orderDraft(subject, 3).id, live()), undefined);
  assert.deepEqual(await store.create(orderDraft(subject, 1), within(0)), {
    ok: false,
    error: "exists",
  });
  assert.ok((await store.create(orderDraft(other, 4), within(2))).ok);
  assert.ok((await store.move([orderMove(1, 0, "cancelled")], live())).ok);
  assert.ok((await store.create(orderDraft(subject, 3), within(2))).ok);
  assert.ok((await store.create(orderDraft(subject, 5), live())).ok);
}

async function takesOneOfTwoForTheLastRoom(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  assert.ok((await store.create(orderDraft(subject, 1), live())).ok);
  const both = await Promise.all([
    store.create(orderDraft(subject, 2), within(2)),
    store.create(orderDraft(subject, 3), within(2)),
  ]);
  assert.equal(both.filter(({ ok }) => ok).length, 1);
  assert.deepEqual(
    both.find(({ ok }) => !ok),
    { ok: false, error: "quota" },
  );
}

/**
 * The checks of an `OrderStore`'s open orders' quota (decision 0431): a create past the agent's
 * orders awaiting their card, active or paused is `quota` and writes nothing, counted in the same
 * write, so two racing for the last room never both pass; an ended order and another agent's
 * orders leave room.
 */
export function orderQuotaChecks(
  create: () => Promise<OrderStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn("refuses an order past the open orders' quota", create, refusesAnOrderPastItsQuota),
    checkOn(
      "takes one of two orders made at once for the last room",
      create,
      takesOneOfTwoForTheLastRoom,
    ),
  ];
}
