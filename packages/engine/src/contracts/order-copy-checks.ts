import assert from "node:assert/strict";
import type { AccountRef } from "@binference/chain";
import type { OrderRequest } from "@binference/protocol";
import { maxTrackedWallets } from "../alerts/alert-record.js";
import type { OrderDraft } from "../orders/order-record.js";
import { walletCondition } from "./alert-fire-checks.js";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import { fillRow } from "./order-fill-checks.js";
import { confirmedCard, orderDraft, orderMove, type OrderStoreSubject } from "./order-fixtures.js";
import { fixtureId, inOrder, live } from "./store-fixtures.js";

// The account of wallet condition `n`, which the alert checks name too.
function leaderOf(n: number): AccountRef {
  const condition = walletCondition(n);
  return condition.kind === "wallet" ? condition.account : assert.fail("not a wallet condition");
}

// Order `n`, a copy of leader `leader`, its caps past 64 bits.
function copyDraft(subject: OrderStoreSubject, n: number, leader: number): OrderDraft {
  const draft = orderDraft(subject, n);
  if (draft.request.kind !== "limit") {
    return assert.fail("The fixture order is a limit order.");
  }
  const { trigger: _trigger, worstPrice: _worst, kind: _kind, ...base } = draft.request;
  const request: OrderRequest = {
    ...base,
    kind: "copy",
    trigger: {
      leader: leaderOf(leader),
      perBuyUsdMicros: 2n ** 64n + 1n,
      dailyUsdMicros: 2n ** 64n + 1n,
    },
  };
  return { ...draft, request };
}

/**
 * A copy order awaiting its card holds its leader's slot among the install's 50 tracked wallets:
 * a 51st leader is `track_limit`, a leader already tracked passes, and a cancelled order frees
 * its slot (decision 0251).
 */
export async function holdsTrackedWalletSlots(subject: OrderStoreSubject): Promise<void> {
  const { store } = subject;
  const numbers = Array.from({ length: maxTrackedWallets }, (_, index) => index + 1);
  await inOrder(numbers, async (n) => store.create(copyDraft(subject, n, n), live()));
  const more = copyDraft(subject, 60, 60);
  assert.deepEqual(await store.create(more, live()), { ok: false, error: "track_limit" });
  assert.equal((await store.create(copyDraft(subject, 61, 5), live())).ok, true);
  assert.equal((await store.move([orderMove(7, 0, "cancelled")], live())).ok, true);
  assert.equal((await store.create(more, live())).ok, true);
}

// Copy order `n` of leader `leader`, active on its confirmed card.
async function activeCopy(subject: OrderStoreSubject, n: number, leader: number): Promise<void> {
  const card = await confirmedCard(subject, n);
  assert.ok((await subject.store.create(copyDraft(subject, n, leader), live())).ok);
  const active = { ...orderMove(n, 0, "active"), cardId: card };
  assert.ok((await subject.store.move([active], live())).ok);
}

// A fill of order `order` at version `version`, its intent `intent` of `kind` judged at `value`,
// its row `row` at `1000 * row`.
async function landed(
  subject: OrderStoreSubject,
  call: {
    readonly order: number;
    readonly version: number;
    readonly intent: number;
    readonly row: number;
    readonly kind: "buy" | "sell";
    readonly value?: bigint;
  },
): Promise<void> {
  const { store, intents } = subject;
  const { order, version, intent, row, kind, value } = call;
  assert.ok((await intents.create({ ...intentDraft(subject, intent), kind }, live())).ok);
  const fields = value === undefined ? {} : { fields: { valueUsdMicros: value } };
  assert.ok(
    (await intents.transition({ ...intentMove(intent, 0, "checked"), ...fields }, live())).ok,
  );
  const move = { ...orderMove(order, version, "active"), fills: version };
  const fill = { ...fillRow(order, row, "filled"), intentId: fixtureId("int", intent) };
  assert.ok((await store.recordLandedFill({ moves: [move], fill }, live())).ok);
}

/**
 * An agent's copy buys of one leader come from every copy order of it, whatever the order's state,
 * at the intent's judged value, else the order's dollars per buy, oldest first and paged; sales and
 * other leaders' orders are left out (decision 0260).
 */
export async function listsCopyBuys(subject: OrderStoreSubject): Promise<void> {
  const { store, agentId } = subject;
  await activeCopy(subject, 1, 1);
  await activeCopy(subject, 2, 1);
  await activeCopy(subject, 3, 2);
  await landed(subject, { order: 1, version: 1, intent: 11, row: 21, kind: "buy", value: 7n });
  await landed(subject, { order: 2, version: 1, intent: 12, row: 22, kind: "buy" });
  await landed(subject, { order: 1, version: 2, intent: 13, row: 23, kind: "sell", value: 5n });
  await landed(subject, { order: 3, version: 1, intent: 14, row: 24, kind: "buy", value: 9n });
  assert.ok((await store.move([orderMove(2, 2, "cancelled")], live())).ok);
  const query = { agentId, leader: leaderOf(1), fromMs: 0, limit: 10 };
  const all = await store.copyBuys(query, live());
  assert.deepEqual(all, [
    { id: fixtureId("fil", 21), atMs: 21_000, usdMicros: 7n },
    { id: fixtureId("fil", 22), atMs: 22_000, usdMicros: 2n ** 64n + 1n },
  ]);
  const [first] = all;
  const after = { atMs: first?.atMs ?? 0, id: first?.id ?? fixtureId("fil", 0) };
  assert.deepEqual(await store.copyBuys({ ...query, limit: 1, after }, live()), all.slice(1));
  assert.deepEqual(await store.copyBuys({ ...query, fromMs: 21_001 }, live()), all.slice(1));
}
