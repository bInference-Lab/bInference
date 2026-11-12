import assert from "node:assert/strict";
import type { AccountRef } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { TrackedWalletStore } from "../leaders/ports.js";
import type { LeaderReadRecord } from "../leaders/tracked-wallet-record.js";
import { alertOf, walletCondition } from "./alert-fire-checks.js";
import type { AlertSubject } from "./alert-store-contract.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";
import { trackedActivityChecks } from "./tracked-activity-checks.js";
import { accountOf, chain, other, readOf, saleOf, track } from "./tracked-wallet-fixtures.js";

/** A tracked wallet store under test, with the alert store of the same database. */
export interface TrackedWalletSubject extends AlertSubject {
  readonly tracked: TrackedWalletStore;
}

/** Makes a fresh subject for each check. */
export interface TrackedWalletStoreHarness {
  create(): Promise<TrackedWalletSubject>;
}

async function accounts(subject: TrackedWalletSubject): Promise<readonly AccountRef[]> {
  return (await subject.tracked.tracked(chain, live())).map(({ account }) => account);
}

async function followsAlerts(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  await track(subject, 1, 2);
  assert.deepEqual(await accounts(subject), [accountOf(1)]);
  assert.deepEqual(await subject.tracked.tracked(other, live()), []);
  await subject.alerts.delete({ id: fixtureId("alr", 1), atMs: 5 }, live());
  assert.deepEqual(await accounts(subject), [accountOf(1)]);
  await subject.alerts.end({ id: fixtureId("alr", 2), atMs: 6 }, live());
  assert.deepEqual(await accounts(subject), []);
}

async function storesEachTradeOnce(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  const trades = [saleOf(1, 11), saleOf(1, 12, 3)];
  const read = readOf([10, 12], { trades });
  const stored = await subject.tracked.record(read, live());
  assert.deepEqual(
    stored.map(({ id: _id, ...trade }) => trade),
    trades,
  );
  assert.deepEqual(await subject.tracked.record(read, live()), []);
  const listed = await subject.tracked.activity({ account: accountOf(1), limit: 10 }, live());
  assert.deepEqual(listed, stored.toReversed());
  assert.deepEqual(await subject.tracked.cursor(chain, live()), {
    chain,
    block: 12n,
    blockHash: read.toHash,
    atMs: 12_000,
  });
  assert.deepEqual(await subject.tracked.tracked(chain, live()), [
    { account: accountOf(1), sinceBlock: 10n, lastBlock: 12n, overflowBlocks: 0, addedAtMs: 1 },
  ]);
}

async function movesOnlyWhatTheReadReached(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  const stranger = saleOf(9, 11);
  const early = readOf([10, 12], {
    wallets: [{ account: accountOf(1), sinceBlock: 20n, readFrom: 20n }],
    trades: [stranger],
    overflows: [
      { account: accountOf(1), block: 11n },
      { account: accountOf(9), block: 11n },
    ],
  });
  assert.deepEqual(await subject.tracked.record(early, live()), []);
  assert.deepEqual(await subject.tracked.tracked(chain, live()), [
    { account: accountOf(1), overflowBlocks: 1, addedAtMs: 1 },
  ]);
  assert.deepEqual(await subject.tracked.activity({ account: accountOf(9), limit: 5 }, live()), []);
}

// Wallet 1's blocks `block` and the next, each cut short.
function cut(block: number): LeaderReadRecord["overflows"] {
  return [
    { account: accountOf(1), block: BigInt(block) },
    { account: accountOf(1), block: BigInt(block + 1) },
  ];
}

async function tellsCutBlocksOnceADay(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  await track(subject, 2, 2);
  await subject.tracked.record(readOf([10, 12], { overflows: cut(10) }), live());
  const day = { everyMs: 86_400_000, limit: 10 };
  const first = await subject.tracked.overflowsToTell({ ...day, atMs: 1_000 }, live());
  assert.deepEqual(first, [{ account: accountOf(1), blocks: 2 }]);
  assert.deepEqual(await subject.tracked.overflowsToTell({ ...day, atMs: 2_000 }, live()), []);
  await subject.tracked.record(readOf([13, 15], { overflows: cut(13).slice(1) }), live());
  assert.deepEqual(await subject.tracked.overflowsToTell({ ...day, atMs: 2_000 }, live()), []);
  const later = { ...day, atMs: 1_000 + day.everyMs };
  assert.deepEqual(await subject.tracked.overflowsToTell(later, live()), [
    { account: accountOf(1), blocks: 1 },
  ]);
  assert.deepEqual(await subject.tracked.overflowsToTell(later, live()), []);
}

async function startsANewSpan(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  await subject.tracked.record(readOf([10, 12], { trades: [saleOf(1, 11)] }), live());
  await subject.alerts.delete({ id: fixtureId("alr", 1), atMs: 20 }, live());
  await track(subject, 1, 2);
  const [again] = await subject.tracked.tracked(chain, live());
  assert.equal(again?.sinceBlock, undefined);
  assert.equal(again?.lastBlock, undefined);
  const kept = await subject.tracked.activity({ account: accountOf(1), limit: 5 }, live());
  assert.equal(kept.length, 1);
}

async function leavesArchivedAgents(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  await track(subject, 2, 3);
  await subject.alerts.create(
    alertOf(subject, 4, { condition: walletCondition(2), agentId: subject.agentIds[1] }),
    live(),
  );
  await subject.archive(subject.agentIds[0]);
  assert.deepEqual(await accounts(subject), [accountOf(2)]);
}

async function refusesAborted(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  const read = readOf([10, 12], { trades: [saleOf(1, 11)] });
  await assertRefusesAborted(async (call) => subject.tracked.record(read, call));
  assert.deepEqual(await subject.tracked.activity({ account: accountOf(1), limit: 5 }, live()), []);
  assert.equal(await subject.tracked.cursor(chain, live()), undefined);
}

/** The checks every {@link TrackedWalletStore} passes. */
export function trackedWalletStoreContract(
  harness: TrackedWalletStoreHarness,
): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn("tracks a wallet alert's account until its last alert ends", create, followsAlerts),
    checkOn("stores each trade once and answers only the new ones", create, storesEachTradeOnce),
    checkOn(
      "moves only what a read reached, for tracked wallets",
      create,
      movesOnlyWhatTheReadReached,
    ),
    checkOn("tells each wallet's cut blocks at most once a day", create, tellsCutBlocksOnceADay),
    checkOn("starts a new span when a wallet is tracked again", create, startsANewSpan),
    checkOn("tracks no wallet only an archived agent names", create, leavesArchivedAgents),
    ...trackedActivityChecks(create),
    checkOn("refuses a call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
