import assert from "node:assert/strict";
import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import {
  creatorWindowMs,
  type LaunchReadRecord,
  launchKeepMs,
  type NewLaunch,
  type StoredLaunch,
} from "../launches/launch-record.js";
import type { LaunchStore } from "../launches/ports.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

/** Makes a fresh, empty launch store for each check. */
export interface LaunchStoreHarness {
  create(): Promise<LaunchStore>;
}

const chain = chainRefSchema.parse("fake:1");
const other = chainRefSchema.parse("fake:2");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const quote = assetRefSchema.parse("fake:1/token:0x000000c0");
const dayMs = 24 * 60 * 60 * 1_000;
const startMs = 1_800_000_000_000;

const tokenOf = (n: number): AssetRef =>
  assetRefSchema.parse(`fake:1/token:0x${n.toString(16).padStart(8, "0")}`);
const accountOf = (n: number): AccountRef =>
  accountRefSchema.parse(`fake:1:0x${(0xa0 + n).toString(16).padStart(8, "0")}`);

function txOf(block: number, n: number): TxHash {
  const hash = `0x${block.toString(16).padStart(32, "0")}${n.toString(16).padStart(32, "0")}`;
  return isTxHash(hash) ? hash : assert.fail("not a hash");
}

/** Launch `n` of creator `creator` at `block`, `block` days after the start. */
function launchOf(n: number, block: number, extra: Partial<NewLaunch> = {}): NewLaunch {
  return {
    token: tokenOf(n),
    launchpad: "test-pad",
    creator: accountOf(1),
    quoteToken: coin,
    symbol: `T${String(n)}`,
    decimals: 18,
    taxBps: bpsSchema.parse(100),
    curveProgressBps: bpsSchema.parse(0),
    graduated: false,
    insiders: [accountOf(1)],
    block: BigInt(block),
    blockHash: `0x${block.toString(16).padStart(64, "0")}`,
    txHash: txOf(block, n),
    logIndex: n,
    launchedAtMs: startMs + block * dayMs,
    ...extra,
  };
}

// A read of blocks `from` to `to` holding the launches given.
function readOf(
  span: readonly [number, number],
  launches: readonly NewLaunch[],
  extra: Partial<LaunchReadRecord> = {},
): LaunchReadRecord {
  const [from, to] = span;
  return {
    chain,
    from: BigInt(from),
    to: BigInt(to),
    toHash: `0x${to.toString(16).padStart(64, "0")}`,
    atMs: startMs + to * dayMs,
    launches,
    changes: [],
    ...extra,
  };
}

const tokens = (launches: readonly StoredLaunch[]): readonly AssetRef[] =>
  launches.map(({ token }) => token);

async function listed(store: LaunchStore, extra: object = {}): Promise<readonly AssetRef[]> {
  return tokens(await store.list({ chain, limit: 50, ...extra }, live()));
}

async function storesEachLaunchOnce(store: LaunchStore): Promise<void> {
  const read = readOf([1, 2], [launchOf(1, 1), launchOf(2, 2)]);
  const first = await store.record(read, live());
  assert.deepEqual(tokens(first), [tokenOf(1), tokenOf(2)]);
  assert.deepEqual(first[0], {
    ...launchOf(1, 1),
    chain,
    changedAtMs: read.atMs,
    creatorLaunches30d: 0,
  });
  assert.deepEqual(await store.record(read, live()), []);
  assert.deepEqual(await listed(store), [tokenOf(2), tokenOf(1)]);
  assert.deepEqual(await store.cursor(chain, live()), {
    chain,
    block: 2n,
    blockHash: read.toHash,
    atMs: read.atMs,
  });
  assert.equal(await store.cursor(other, live()), undefined);
}

async function countsCreatorLaunches(store: LaunchStore): Promise<void> {
  const second = { creator: accountOf(2) };
  await store.record(readOf([0, 0], [launchOf(1, 0)]), live());
  await store.record(readOf([10, 10], [launchOf(2, 10), launchOf(3, 10, second)]), live());
  const [late] = await store.record(readOf([35, 35], [launchOf(4, 35)]), live());
  assert.equal(late?.creatorLaunches30d, 1);
  const counts = (await store.list({ chain, limit: 10 }, live())).map(
    ({ creatorLaunches30d }) => creatorLaunches30d,
  );
  assert.deepEqual(counts, [1, 0, 1, 0]);
  assert.equal(creatorWindowMs, 30 * dayMs);
}

async function forgetsReorganizedLaunches(store: LaunchStore): Promise<void> {
  await store.record(readOf([3, 6], [launchOf(1, 4), launchOf(2, 6)]), live());
  const again = await store.record(readOf([4, 6], [launchOf(1, 6, { logIndex: 9 })]), live());
  assert.deepEqual(again, []);
  const [moved, ...rest] = await store.list({ chain, limit: 10 }, live());
  assert.deepEqual(rest, []);
  assert.equal(moved?.token, tokenOf(1));
  assert.equal(moved?.block, 6n);
  assert.equal(moved?.logIndex, 9);
}

async function followsCurveChanges(store: LaunchStore): Promise<void> {
  await store.record(readOf([1, 1], [launchOf(1, 1), launchOf(2, 1)]), live());
  const changes = [
    { token: tokenOf(1), curveProgressBps: bpsSchema.parse(1_000) },
    { token: tokenOf(1), curveProgressBps: bpsSchema.parse(2_500) },
    { token: tokenOf(2), graduated: true },
    { token: tokenOf(9), graduated: true },
  ];
  const read = readOf([2, 2], [], { changes });
  await store.record(read, live());
  const stored = await store.list({ chain, limit: 10 }, live());
  const curves = stored.map(({ curveProgressBps, graduated, changedAtMs }) => [
    curveProgressBps,
    graduated,
    changedAtMs,
  ]);
  assert.deepEqual(curves, [
    [0, true, read.atMs],
    [2_500, false, read.atMs],
  ]);
}

// A launch whose tax the feed did not read.
function untaxed(launch: NewLaunch): NewLaunch {
  const { taxBps: _unread, ...rest } = launch;
  return rest;
}

async function pagesAndFilters(store: LaunchStore): Promise<void> {
  const taxed = { taxBps: bpsSchema.parse(500), quoteToken: quote };
  const insiders = [accountOf(1), accountOf(2)];
  const launches = [launchOf(1, 1), launchOf(2, 2, taxed), untaxed(launchOf(3, 3, { insiders }))];
  await store.record(readOf([1, 3], launches), live());
  const [newest] = await store.list({ chain, limit: 1 }, live());
  assert.equal(newest?.token, tokenOf(3));
  const before = { launchedAtMs: newest?.launchedAtMs ?? 0, block: 3n, logIndex: 3 };
  assert.deepEqual(await listed(store, { before }), [tokenOf(2), tokenOf(1)]);
  assert.deepEqual(await listed(store, { fromMs: startMs + 2 * dayMs }), [tokenOf(3), tokenOf(2)]);
  assert.deepEqual(await listed(store, { filters: { maxTaxBps: 100 } }), [tokenOf(1)]);
  assert.deepEqual(await listed(store, { filters: { quoteTokens: [quote] } }), [tokenOf(2)]);
  assert.deepEqual(await listed(store, { filters: { maxInsiders: 1 } }), [tokenOf(2), tokenOf(1)]);
  assert.deepEqual(await listed(store, { filters: { maxCreatorLaunches30d: 0 } }), [tokenOf(1)]);
  assert.deepEqual(await listed(store, { filters: { launchpads: ["other-pad"] } }), []);
  assert.deepEqual(await listed(store, { filters: { minCurveProgressBps: 1 } }), []);
  assert.deepEqual(await listed(store, { chain: other }), []);
}

async function keepsNinetyDays(store: LaunchStore): Promise<void> {
  await store.record(readOf([0, 0], [launchOf(1, 0)]), live());
  await store.record(readOf([1, 1], [launchOf(2, 1)]), live());
  const keepDays = launchKeepMs / dayMs + 1;
  await store.record(readOf([keepDays, keepDays], []), live());
  assert.deepEqual(await listed(store), [tokenOf(2)]);
}

/** The contract every `LaunchStore` passes. */
export function launchStoreContract(harness: LaunchStoreHarness): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn(
      "stores each launch once, in the read's order, with the cursor",
      create,
      storesEachLaunchOnce,
    ),
    checkOn(
      "counts the launches of a launch's creator in the 30 days before it",
      create,
      countsCreatorLaunches,
    ),
    checkOn(
      "forgets a launch a reorganization removed, and moves one read in another block",
      create,
      forgetsReorganizedLaunches,
    ),
    checkOn(
      "follows each launch's curve changes, the later one winning",
      create,
      followsCurveChanges,
    ),
    checkOn(
      "lists newest first, a page at a time, from a time and through the filters",
      create,
      pagesAndFilters,
    ),
    checkOn("keeps a chain's launches 90 days", create, keepsNinetyDays),
    checkOn("refuses calls on an aborted signal", create, async (store) => {
      await assertRefusesAborted(async (call) => store.cursor(chain, call));
      await assertRefusesAborted(async (call) => store.record(readOf([1, 1], []), call));
      await assertRefusesAborted(async (call) => store.list({ chain, limit: 1 }, call));
    }),
  ];
}
