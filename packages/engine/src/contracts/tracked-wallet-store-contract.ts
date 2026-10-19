import assert from "node:assert/strict";
import {
  type AccountRef,
  assetRefParts,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { testCoin } from "../intents/test-intents.js";
import type { TrackedWalletStore } from "../leaders/ports.js";
import type { LeaderReadRecord, WalletActivity } from "../leaders/tracked-wallet-record.js";
import { alertOf, priceAsset, walletCondition } from "./alert-fire-checks.js";
import type { AlertSubject } from "./alert-store-contract.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** A tracked wallet store under test, with the alert store of the same database. */
export interface TrackedWalletSubject extends AlertSubject {
  readonly tracked: TrackedWalletStore;
}

/** Makes a fresh subject for each check. */
export interface TrackedWalletStoreHarness {
  create(): Promise<TrackedWalletSubject>;
}

// The alert checks' fixture token and accounts are on the test chain; nothing is on the other.
const token = priceAsset;
const coin = testCoin;
const chain = assetRefParts(token).chain;
const other = chainRefSchema.parse("fake:2");

function accountOf(n: number): AccountRef {
  const condition = walletCondition(n);
  return condition.kind === "wallet" ? condition.account : assert.fail("no wallet condition");
}

function txOf(n: number): TxHash {
  const hash = `0x${n.toString(16).padStart(64, "0")}`;
  return isTxHash(hash) ? hash : assert.fail("not a hash");
}

/** A sale of wallet `n` at `block`, at `block` seconds, its amount past 64 bits. */
function saleOf(n: number, block: number, logIndex = 0): WalletActivity {
  return {
    account: accountOf(n),
    block: BigInt(block),
    txHash: txOf(block),
    logIndex,
    side: "sell",
    asset: token,
    amount: 2n ** 64n + 1n,
    counterAsset: coin,
    counterAmount: 3n,
    valueUsdMicros: 7n,
    shareSoldBps: bpsSchema.parse(4_000),
    venue: "test-venue",
    atMs: block * 1_000,
  };
}

// A read of blocks `from` to `to`, block `n` at `n` seconds, of wallet 1 from `from`.
function readOf(
  span: readonly [number, number],
  extra: Partial<Omit<LeaderReadRecord, "from" | "to">> = {},
): LeaderReadRecord {
  const [from, to] = span.map((block) => BigInt(block));
  return {
    chain,
    from: from ?? 0n,
    to: to ?? 0n,
    toHash: `0x${span[1].toString(16).padStart(64, "0")}`,
    atMs: span[1] * 1_000,
    wallets: [{ account: accountOf(1), sinceBlock: from ?? 0n, readFrom: from ?? 0n }],
    trades: [],
    overflows: [],
    ...extra,
  };
}

async function track(subject: TrackedWalletSubject, n: number, alert = n): Promise<void> {
  const created = await subject.alerts.create(
    alertOf(subject, alert, { condition: walletCondition(n) }),
    live(),
  );
  assert.equal(created.ok, true);
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

async function tellsCutBlocksOnceADay(subject: TrackedWalletSubject): Promise<void> {
  await track(subject, 1);
  await track(subject, 2, 2);
  const cut = (block: number) => [
    { account: accountOf(1), block: BigInt(block) },
    { account: accountOf(1), block: BigInt(block + 1) },
  ];
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
    checkOn("pages a wallet's trades newest first, by time", create, pagesActivity),
    checkOn("refuses a call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
