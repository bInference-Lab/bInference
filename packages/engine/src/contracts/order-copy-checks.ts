import assert from "node:assert/strict";
import type { AccountRef } from "@binference/chain";
import type { OrderRequest } from "@binference/protocol";
import { maxTrackedWallets } from "../alerts/alert-record.js";
import type { OrderDraft } from "../orders/order-record.js";
import { walletCondition } from "./alert-fire-checks.js";
import { orderDraft, orderMove, type OrderStoreSubject } from "./order-fixtures.js";
import { inOrder, live } from "./store-fixtures.js";

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
