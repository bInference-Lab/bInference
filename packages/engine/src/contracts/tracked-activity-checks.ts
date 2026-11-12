import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { WalletActivity } from "../leaders/tracked-wallet-record.js";
import { checkOn, live } from "./store-fixtures.js";
import { accountOf, readOf, saleOf, track } from "./tracked-wallet-fixtures.js";
import type { TrackedWalletSubject } from "./tracked-wallet-store-contract.js";

// The tracked wallet store's checks of the trades it stores: their pages, the trades after one,
// their order within one millisecond and the trades a reorganization removed.

async function pagesActivity(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  const trades = [saleOf(1, 11), saleOf(1, 12), saleOf(1, 13)];
  await subject.tracked.record(readOf([10, 13], { trades }), live());
  const account = accountOf(1);
  const [newest, middle] = await subject.tracked.activity({ account, limit: 2 }, live());
  assert.equal(newest?.block, 13n);
  const before = { atMs: middle?.atMs ?? 0, id: middle?.id ?? 0 };
  const rest = await subject.tracked.activity({ account, before, limit: 5 }, live());
  assert.deepEqual(
    rest.map(({ block }) => block),
    [11n],
  );
  const ranged = await subject.tracked.activity(
    { account, fromMs: 12_000, toMs: 12_000, limit: 5 },
    live(),
  );
  assert.deepEqual(
    ranged.map(({ block }) => block),
    [12n],
  );
}

async function listsTradesSince(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  await track(subject, 2, 2);
  const trades = [saleOf(1, 11), saleOf(2, 11, 1), saleOf(1, 12), saleOf(1, 13)];
  const stored = await subject.tracked.record(readOf([10, 13], { trades }), live());
  const account = accountOf(1);
  const [first, , second, third] = stored.map(({ id }) => id);
  const all = await subject.tracked.since({ account, afterId: 0, limit: 5 }, live());
  assert.deepEqual(
    all.map(({ id }) => id),
    [first, second, third],
  );
  const after = await subject.tracked.since({ account, afterId: first ?? 0, limit: 1 }, live());
  assert.deepEqual(
    after.map(({ id }) => id),
    [second],
  );
  const recent = { account, afterId: 0, fromMs: 13_000, limit: 5 };
  assert.deepEqual(
    (await subject.tracked.since(recent, live())).map(({ id }) => id),
    [third],
  );
}

// A sale of wallet 1 at `block`, at the one instant such sales share.
function saleAtOneInstant(block: number): WalletActivity {
  return { ...saleOf(1, block), atMs: 20_000 };
}

// Trades of one millisecond page newest stored first and list since one in the order stored.
async function ordersOneInstantByStore(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  const trades = [13, 11, 12].map(saleAtOneInstant);
  const stored = await subject.tracked.record(readOf([10, 13], { trades }), live());
  const ids = stored.map(({ id }) => id);
  const account = accountOf(1);
  const page = await subject.tracked.activity({ account, limit: 2 }, live());
  assert.deepEqual(
    page.map(({ id }) => id),
    ids.toReversed().slice(0, 2),
  );
  const since = await subject.tracked.since({ account, afterId: 0, limit: 5 }, live());
  assert.deepEqual(
    since.map(({ id }) => id),
    ids,
  );
}

async function dropsRemovedTrades(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  const account = accountOf(1);
  const [moved] = await subject.tracked.record(
    readOf([10, 12], { trades: [saleOf(1, 11), saleOf(1, 12)] }),
    live(),
  );
  const again = readOf([11, 13], {
    wallets: [{ account, sinceBlock: 10n, readFrom: 11n }],
    trades: [saleOf(1, 12), saleOf(1, 13)],
  });
  const [added] = await subject.tracked.record(again, live());
  const left = await subject.tracked.since({ account, afterId: 0, limit: 10 }, live());
  assert.deepEqual(
    left.map(({ block }) => block),
    [12n, 13n],
  );
  assert.equal(
    left.some(({ id }) => id === moved?.id),
    false,
  );
  assert.equal((added?.id ?? 0) > (moved?.id ?? 0), true);
}

/** The tracked wallet store's checks of a wallet's stored trades. */
export function trackedActivityChecks(
  create: () => Promise<TrackedWalletSubject>,
): readonly ContractCheck[] {
  return [
    checkOn("pages a wallet's trades newest first, by time", create, pagesActivity),
    checkOn("lists a wallet's trades stored after a given one, in order", create, listsTradesSince),
    checkOn(
      "pages and lists a wallet's trades of one millisecond in the order stored",
      create,
      ordersOneInstantByStore,
    ),
    checkOn(
      "drops the trades of a block read again that the read no longer holds",
      create,
      dropsRemovedTrades,
    ),
  ];
}
