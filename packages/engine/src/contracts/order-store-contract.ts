import assert from "node:assert/strict";
import { bpsSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { FillSize } from "@binference/protocol";
import { testCoin } from "../intents/test-intents.js";
import type { OrderDraft, OrderQuery } from "../orders/order-record.js";
import { holdsTrackedWalletSlots } from "./order-copy-checks.js";
import {
  announcesFillNotices,
  countsALandedFillOnce,
  linksALateLandingWithItsFill,
  listsTheFillsInFlight,
  recordsSkips,
  refusesAbortedFills,
  refusesAFillWithoutItsOrderMove,
  writesAFillWithItsIntent,
} from "./order-fill-checks.js";
import { orderDraft, orderMove, type OrderStoreSubject } from "./order-fixtures.js";
import {
  activatesOnTheConfirmedCard,
  freezesAndUnfreezesOrders,
  writesAFrozenFillsRow,
  refusesAnActiveOrderOfAFrozenAgent,
} from "./order-freeze-checks.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

const id = (n: number) => fixtureId("ord", n);

/** Makes a fresh, empty order store for each check. */
export interface OrderStoreHarness {
  create(): Promise<OrderStoreSubject>;
}

async function createsOrders(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  const draft = orderDraft(subject, 1);
  const created = await store.create(draft, live());
  assert.ok(created.ok);
  const { atMs, ...fields } = draft;
  const expected = {
    ...fields,
    kind: "limit",
    state: "awaiting_confirmation",
    fills: 0,
    createdAtMs: atMs,
    changedAtMs: atMs,
    version: 0,
  };
  assert.deepEqual(created.value, expected);
  assert.deepEqual(await store.get(draft.id, live()), expected);
  assert.deepEqual(await store.byIntent(draft.intentId, live()), expected);
  assert.deepEqual(await store.create({ ...draft, atMs: 999 }, live()), {
    ok: false,
    error: "exists",
  });
  assert.equal(await store.get(fixtureId("ord", 9), live()), undefined);
  assert.equal(await store.byIntent(fixtureId("int", 9), live()), undefined);
}

// A buy order of order `n`, spending the chain's coin, sized as given.
function buyDraft(subject: OrderStoreSubject, n: number, size: FillSize): OrderDraft {
  const draft = orderDraft(subject, n);
  return { ...draft, request: { ...draft.request, side: "buy", spend: testCoin, size } };
}

// A buy order keeps what it spends and its size exact: base units past 64 bits, or a share.
async function keepsBuySizes(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  const byBase = buyDraft(subject, 1, { base: 2n ** 64n + 3n });
  const byShare = buyDraft(subject, 2, { percentBps: bpsSchema.parse(2_500) });
  assert.ok((await store.create(byBase, live())).ok);
  assert.ok((await store.create(byShare, live())).ok);
  assert.deepEqual((await store.get(byBase.id, live()))?.request, byBase.request);
  assert.deepEqual((await store.get(byShare.id, live()))?.request, byShare.request);
}

async function refusesStrangers(subject: OrderStoreSubject): Promise<void> {
  const { store, other } = subject;
  const foreign = { ...orderDraft(subject, 1), walletId: other.walletId };
  await assert.rejects(store.create(foreign, live()), { code: "store.constraint" });
  const unknown = { ...orderDraft(subject, 2), agentId: fixtureId("agt", 99) };
  await assert.rejects(store.create(unknown, live()), { code: "store.constraint" });
  assert.deepEqual(await store.list({ states: ["awaiting_confirmation"], limit: 10 }, live()), []);
}

async function movesUnderVersion(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  await store.create(orderDraft(subject, 1), live());
  await store.create(orderDraft(subject, 2), live());
  const cancelled = await store.move([orderMove(1, 0, "cancelled")], live());
  assert.ok(cancelled.ok);
  assert.deepEqual(
    cancelled.value.map(({ state, version, changedAtMs }) => ({ state, version, changedAtMs })),
    [{ state: "cancelled", version: 1, changedAtMs: 1_000 }],
  );
  assert.deepEqual(await store.move([orderMove(2, 1, "expired")], live()), {
    ok: false,
    error: "stale",
  });
  assert.deepEqual(await store.move([orderMove(9, 0, "expired")], live()), {
    ok: false,
    error: "not_found",
  });
  const noticed = { ...orderMove(2, 0, "awaiting_confirmation"), expiryNoticedAtMs: 1_500 };
  const both = await store.move([noticed, orderMove(9, 0, "expired")], live());
  assert.deepEqual(both, { ok: false, error: "not_found" });
  assert.equal((await store.get(fixtureId("ord", 2), live()))?.version, 0);
  const marked = await store.move([noticed], live());
  assert.ok(marked.ok);
  assert.equal(marked.value[0]?.expiryNoticedAtMs, 1_500);
}

async function refusesBrokenRules(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  await store.create(orderDraft(subject, 1), live());
  await store.create(orderDraft(subject, 2), live());
  const twice = [orderMove(1, 0, "cancelled"), orderMove(1, 0, "expired")];
  await assert.rejects(store.move(twice, live()), { code: "store.constraint" });
  const reason = { ...orderMove(1, 0, "cancelled"), endReason: "position_closed" } as const;
  await assert.rejects(store.move([reason], live()), { code: "store.constraint" });
  assert.ok((await store.move([orderMove(1, 0, "cancelled")], live())).ok);
  await assert.rejects(store.move([orderMove(1, 1, "active")], live()), {
    code: "store.constraint",
  });
  const ended = { ...orderMove(2, 0, "ended"), endReason: "position_closed" } as const;
  const moved = await store.move([ended], live());
  assert.ok(moved.ok);
  assert.equal(moved.value[0]?.endReason, "position_closed");
}

// A live fill that landed after its order ended still counts on it, and that alone moves an ended
// order (decision 0210).
async function countsALandedFillOnAnEndedOrder(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  await store.create(orderDraft(subject, 1), live());
  assert.ok((await store.move([orderMove(1, 0, "cancelled")], live())).ok);
  const count = { ...orderMove(1, 1, "cancelled"), fills: 1 };
  await assert.rejects(store.move([{ ...count, fills: 2 }], live()), { code: "store.constraint" });
  await assert.rejects(store.move([{ ...count, state: "expired" }], live()), {
    code: "store.constraint",
  });
  const kept = { ...count, triggerState: { disarmed: true } };
  await assert.rejects(store.move([kept], live()), { code: "store.constraint" });
  const counted = await store.move([count], live());
  assert.ok(counted.ok);
  assert.deepEqual(
    counted.value.map(({ state, fills, version }) => ({ state, fills, version })),
    [{ state: "cancelled", fills: 1, version: 2 }],
  );
}

async function listsByQuery(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  await inOrder([3, 1, 2], async (n) =>
    store.create({ ...orderDraft(subject, n), atMs: 100, expiresAtMs: 1_000 * n }, live()),
  );
  await store.create({ ...orderDraft(subject, 4), isPaper: false, atMs: 50 }, live());
  await store.move([orderMove(2, 0, "cancelled")], live());
  const listed = async (query: Partial<OrderQuery>): Promise<readonly string[]> =>
    (await store.list({ states: ["awaiting_confirmation"], limit: 10, ...query }, live())).map(
      (order) => order.id,
    );
  assert.deepEqual(await listed({}), [id(4), id(1), id(3)]);
  assert.deepEqual(await listed({ isPaper: true }), [id(1), id(3)]);
  assert.deepEqual(await listed({ expiresByMs: 1_000 }), [id(1)]);
  assert.deepEqual(await listed({ states: ["cancelled", "awaiting_confirmation"], limit: 2 }), [
    id(4),
    id(1),
  ]);
  assert.deepEqual(await listed({ after: { createdAtMs: 100, id: id(1) } }), [id(3)]);
  assert.deepEqual(await listed({ agentId: subject.other.agentId }), []);
  assert.deepEqual(await listed({ walletId: subject.walletId }), [id(4), id(1), id(3)]);
}

async function refusesAborted(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  const draft = orderDraft(subject, 1);
  await assertRefusesAborted(async (options) => store.create(draft, options));
  await assertRefusesAborted(async (options) => store.get(draft.id, options));
  await assertRefusesAborted(async (options) => store.byIntent(draft.intentId, options));
  await assertRefusesAborted(async (options) =>
    store.list({ states: ["active"], limit: 1 }, options),
  );
  await assertRefusesAborted(async (options) => store.move([orderMove(1, 0, "active")], options));
  assert.equal(await store.get(draft.id, live()), undefined);
}

// A live fill counted once, a late landing linked with its fill, and the fills that hold a line
// (decision 0211).
function liveFillChecks(create: () => Promise<OrderStoreSubject>): readonly ContractCheck[] {
  return [
    checkOn(
      "counts a landed fill once, apart from its intent's move",
      create,
      countsALandedFillOnce,
    ),
    checkOn(
      "links a late landing with its fill on its order",
      create,
      linksALateLandingWithItsFill,
    ),
    checkOn("lists every live fill that holds its agent's line", create, listsTheFillsInFlight),
  ];
}

/**
 * The checks every {@link OrderStore} adapter passes: orders created once and kept exact past 64
 * bits, a buy's spent asset and size among them, moves all or nothing under their versions, the rules no move may break, an order active
 * only on its card's confirmation and never for a frozen agent, the freeze's own order moves,
 * listing by state, agent, wallet, mode and expiry page by page, fill rows, a fill's moves and row
 * written with its intent's move, and aborted calls.
 */
export function orderStoreContract(harness: OrderStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<OrderStoreSubject> => harness.create();
  return [
    checkOn("creates an order awaiting its card, once, its amounts exact", create, createsOrders),
    checkOn("keeps what a buy order spends and its size, exact", create, keepsBuySizes),
    checkOn("refuses an unknown agent or another agent's wallet", create, refusesStrangers),
    checkOn(
      "holds a copy order's leader among 50 tracked wallets",
      create,
      holdsTrackedWalletSlots,
    ),
    checkOn("moves orders under their versions, all or nothing", create, movesUnderVersion),
    checkOn(
      "refuses a move that breaks an order rule and writes nothing",
      create,
      refusesBrokenRules,
    ),
    checkOn(
      "counts a landed fill on an order that ended, and moves it no other way",
      create,
      countsALandedFillOnAnEndedOrder,
    ),
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
    checkOn("lists orders by state, agent, wallet, mode and expiry", create, listsByQuery),
    checkOn("refuses every call on an aborted signal and writes nothing", create, refusesAborted),
    checkOn("keeps an order's skips, the newest first", create, recordsSkips),
    checkOn("writes a fill on its order with its intent's move", create, writesAFillWithItsIntent),
    ...liveFillChecks(create),
    checkOn("refuses fill calls on an aborted signal", create, refusesAbortedFills),
    checkOn("writes a frozen fill's row with the freeze's cancel", create, writesAFrozenFillsRow),
    checkOn("keeps a row's notices until they are announced", create, announcesFillNotices),
    checkOn(
      "refuses a fill row without its order's own move",
      create,
      refusesAFillWithoutItsOrderMove,
    ),
  ];
}
