import assert from "node:assert/strict";
import { type AssetRef, assetRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { PositionStore } from "../ports.js";
import type {
  ExecutionDraft,
  ExecutionQuery,
  ExecutionRecord,
} from "../positions/execution-record.js";
import type { PositionState, PositionWrite } from "../positions/position-record.js";
import { assertRefusesAborted, checkOn, inOrder, live } from "./store-fixtures.js";

/** A position store under test, with two wallets and an intent that exist in its database. */
export interface PositionStoreSubject {
  readonly store: PositionStore;
  readonly walletIds: readonly [Id<"wal">, Id<"wal">];
  readonly intentId: Id<"int">;
}

/** Makes a fresh, empty position store for each check. */
export interface PositionStoreHarness {
  create(): Promise<PositionStoreSubject>;
}

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
// Above 2^64, so an adapter that stores amounts as 64-bit integers fails.
const huge = 18_446_744_073_709_551_617n;

function draft(subject: PositionStoreSubject, n: number, isPaper = false): ExecutionDraft {
  return {
    intentId: subject.intentId,
    walletId: subject.walletIds[n % 2 === 0 ? 1 : 0],
    isPaper,
    atMs: 1_000 * n,
    sold: { asset: coin, base: huge },
    feeBase: 25n,
    bought: { asset: token, base: 1_000n * BigInt(n) },
    gas: { asset: coin, base: 7n },
    valueUsdMicros: 600_000_000n,
    feeUsdMicros: 1_500_000n,
    gasUsdMicros: 300_000n,
  };
}

function state(walletId: Id<"wal">, asset: AssetRef, quantityBase: bigint): PositionState {
  return {
    walletId,
    asset,
    isPaper: false,
    quantityBase,
    costUsdMicros: 601_800_000n,
    realizedUsdMicros: -1_500_000n,
    changedAtMs: 1_000,
  };
}

async function storesNewPositions(subject: PositionStoreSubject): Promise<void> {
  const [walletId, otherWalletId] = subject.walletIds;
  const writes: PositionWrite[] = [
    { position: state(walletId, token, huge) },
    { position: state(walletId, coin, 5n) },
  ];
  const stored = await subject.store.record(
    { execution: draft(subject, 1), positions: writes },
    live(),
  );
  const other = [{ position: state(otherWalletId, token, 3n) }];
  await subject.store.record({ execution: draft(subject, 2), positions: other }, live());
  assert.ok(stored.ok);
  assert.deepEqual(stored.value, { ...draft(subject, 1), id: stored.value.id });
  assert.deepEqual(await subject.store.positions({ walletId, isPaper: false }, live()), [
    { ...state(walletId, coin, 5n), version: 0 },
    { ...state(walletId, token, huge), version: 0 },
  ]);
  assert.deepEqual(await subject.store.positions({ walletId, isPaper: true }, live()), []);
}

async function movesFromTheVersionRead(subject: PositionStoreSubject): Promise<void> {
  const [walletId] = subject.walletIds;
  const { store } = subject;
  const first = { position: state(walletId, token, 10n) };
  await store.record({ execution: draft(subject, 1), positions: [first] }, live());
  const next = { position: state(walletId, token, 4n), readVersion: 0 };
  const moved = await store.record({ execution: draft(subject, 3), positions: [next] }, live());
  assert.ok(moved.ok);
  const stale = [
    { position: state(walletId, coin, 1n) },
    { ...next, position: state(walletId, token, 1n) },
  ];
  const refused = await store.record({ execution: draft(subject, 5), positions: stale }, live());
  assert.deepEqual(refused, { ok: false, error: "stale" });
  const again = await store.record({ execution: draft(subject, 5), positions: [first] }, live());
  assert.deepEqual(again, { ok: false, error: "stale" });
  assert.deepEqual(await store.positions({ walletId, isPaper: false }, live()), [
    { ...state(walletId, token, 4n), version: 1 },
  ]);
  const page = { after: 0, limit: 10, isPaper: false };
  assert.equal((await store.executions(page, live())).length, 2);
}

async function refusesTwoWritesToOnePosition(subject: PositionStoreSubject): Promise<void> {
  const [walletId] = subject.walletIds;
  const twice = [
    { position: state(walletId, token, 1n) },
    { position: state(walletId, token, 2n) },
  ];
  await assert.rejects(
    subject.store.record({ execution: draft(subject, 1), positions: twice }, live()),
    { code: "store.constraint" },
  );
  assert.deepEqual(
    await subject.store.executions({ after: 0, limit: 10, isPaper: false }, live()),
    [],
  );
}

async function listsExecutions(subject: PositionStoreSubject): Promise<void> {
  const { store, walletIds } = subject;
  const stored = await inOrder([1, 2, 3, 4, 5], async (n) => {
    const recorded = await store.record(
      { execution: draft(subject, n, n === 4), positions: [] },
      live(),
    );
    assert.ok(recorded.ok);
    return recorded.value;
  });
  const [one, two, three, four, five] = stored;
  assert.ok(one && two && three && four && five);
  assert.deepEqual(
    stored.map((execution) => execution.id),
    stored.map((execution) => execution.id).toSorted((a, b) => a - b),
  );
  const list = async (query: Partial<ExecutionQuery>): Promise<readonly ExecutionRecord[]> =>
    store.executions({ after: 0, limit: 10, isPaper: false, ...query }, live());
  assert.deepEqual(await list({}), [one, two, three, five]);
  assert.deepEqual(await list({ isPaper: true }), [four]);
  assert.deepEqual(await list({ limit: 2 }), [one, two]);
  assert.deepEqual(await list({ after: two.id }), [three, five]);
  assert.deepEqual(await list({ walletId: walletIds[0] }), [one, three, five]);
  assert.deepEqual(await list({ fromMs: 2_000, toMs: 3_000 }), [two, three]);
}

async function refusesAborted(subject: PositionStoreSubject): Promise<void> {
  const [walletId] = subject.walletIds;
  const { store } = subject;
  const write = {
    execution: draft(subject, 1),
    positions: [{ position: state(walletId, token, 1n) }],
  };
  await assertRefusesAborted(async (options) => store.record(write, options));
  await assertRefusesAborted(async (options) =>
    store.positions({ walletId, isPaper: false }, options),
  );
  await assertRefusesAborted(async (options) =>
    store.executions({ after: 0, limit: 1, isPaper: false }, options),
  );
  assert.deepEqual(await store.positions({ walletId, isPaper: false }, live()), []);
}

/** The contract every `PositionStore` adapter passes. */
export function positionStoreContract(harness: PositionStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<PositionStoreSubject> => harness.create();
  return [
    checkOn(
      "stores an execution with new positions at version 0, amounts exact",
      create,
      storesNewPositions,
    ),
    checkOn(
      "moves a position only from the version it read, else stores nothing",
      create,
      movesFromTheVersionRead,
    ),
    checkOn(
      "refuses two writes to one position and stores nothing",
      create,
      refusesTwoWritesToOnePosition,
    ),
    checkOn("lists executions in order by mode, wallet, time and page", create, listsExecutions),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
