import assert from "node:assert/strict";
import { fillRow } from "./order-fill-checks.js";
import { orderDraft, type OrderStoreSubject } from "./order-fixtures.js";
import { fixtureId, live } from "./store-fixtures.js";

/**
 * Checks that an agent's fill rows in a range are counted by outcome, the skips by reason, the
 * most frequent first and then by reason code, of every order of the agent and of no other agent,
 * the range's end left out.
 */
export async function countsFillsAndSkips(subject: OrderStoreSubject): Promise<void> {
  const { store, other } = subject;
  assert.ok((await store.create(orderDraft(subject, 1), live())).ok);
  assert.ok((await store.create(orderDraft(subject, 2), live())).ok);
  assert.ok((await store.create(orderDraft(other, 3), live())).ok);
  const rows = [
    fillRow(1, 1, "filled"),
    fillRow(2, 2, "filled"),
    fillRow(1, 3, "skipped"),
    { ...fillRow(2, 4, "skipped"), reason: "nothing_to_sell" as const },
    { ...fillRow(1, 5, "skipped"), reason: "nothing_to_sell" as const },
    fillRow(2, 6, "skipped"),
    { ...fillRow(1, 7, "skipped"), reason: "daily_cap" as const },
    fillRow(3, 8, "filled"),
    fillRow(1, 9, "skipped"),
  ];
  for (const row of rows) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    await store.recordFill(row, live());
  }
  const query = { agentId: subject.agentId, fromMs: 1_000, toMs: 9_000 };
  assert.deepEqual(await store.fillCounts(query, live()), {
    filled: 2,
    skipped: [
      { reason: "nothing_to_sell", count: 2 },
      { reason: "per_trade_cap", count: 2 },
      { reason: "daily_cap", count: 1 },
    ],
  });
  const later = { ...query, fromMs: 3_001 };
  assert.deepEqual(await store.fillCounts(later, live()), {
    filled: 0,
    skipped: [
      { reason: "nothing_to_sell", count: 2 },
      { reason: "daily_cap", count: 1 },
      { reason: "per_trade_cap", count: 1 },
    ],
  });
  const stranger = { ...query, agentId: fixtureId("agt", 9) };
  assert.deepEqual(await store.fillCounts(stranger, live()), { filled: 0, skipped: [] });
}
