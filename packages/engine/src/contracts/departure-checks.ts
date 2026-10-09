import assert from "node:assert/strict";
import { type AssetRef, assetRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { DepartureDraft, DepartureWrite } from "../positions/departure-record.js";
import type { PositionState, PositionWrite } from "../positions/position-record.js";
import type { PositionStoreSubject } from "./position-store-contract.js";
import { assertRefusesAborted, live } from "./store-fixtures.js";
import { hashOf } from "./transaction-store-fixtures.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
// Above 2^64, so an adapter that stores amounts as 64-bit integers fails.
const huge = 18_446_744_073_709_551_617n;

function departure(walletId: Id<"wal">, sent: bigint): DepartureDraft {
  return {
    walletId,
    atMs: 3_000,
    sent: { asset: token, base: sent },
    gas: { asset: coin, base: 21_000n },
    txHash: hashOf(9),
  };
}

function state(walletId: Id<"wal">, asset: AssetRef, quantityBase: bigint): PositionState {
  return {
    walletId,
    asset,
    isPaper: false,
    quantityBase,
    costUsdMicros: quantityBase,
    realizedUsdMicros: -2n,
    changedAtMs: 3_000,
  };
}

// The first wallet holds a live token position at version 0.
async function holding(subject: PositionStoreSubject): Promise<PositionWrite> {
  const [walletId] = subject.walletIds;
  const opened = state(walletId, token, huge);
  const arrival = { walletId, isPaper: false, atMs: 1_000, received: { asset: token, base: huge } };
  const stored = await subject.store.recordArrival(
    { arrival: { ...arrival, valueUsdMicros: huge }, positions: [{ position: opened }] },
    live(),
  );
  assert.ok(stored.ok);
  return { position: state(walletId, token, huge - 5n), readVersion: 0 };
}

function writeOf(
  subject: PositionStoreSubject,
  positions: readonly PositionWrite[],
): DepartureWrite {
  const [walletId, otherWalletId] = subject.walletIds;
  return {
    intentId: subject.intentId,
    departures: [departure(walletId, 5n), departure(otherWalletId, huge)],
    positions,
  };
}

/** Stores an intent's departures with their positions once; a second write gets the first back. */
export async function storesDeparturesOnce(subject: PositionStoreSubject): Promise<void> {
  const { store, intentId } = subject;
  const [walletId, otherWalletId] = subject.walletIds;
  const moved = await holding(subject);
  const stored = await store.recordDepartures(writeOf(subject, [moved]), live());
  assert.ok(stored.ok);
  assert.deepEqual(
    stored.value.map(({ id: _id, ...departed }) => departed),
    [
      { ...departure(walletId, 5n), intentId },
      { ...departure(otherWalletId, huge), intentId },
    ],
  );
  const [first, second] = stored.value;
  assert.ok(first !== undefined && second !== undefined && first.id < second.id);
  const again = await store.recordDepartures(
    { ...writeOf(subject, [{ ...moved, readVersion: 7 }]), departures: [departure(walletId, 1n)] },
    live(),
  );
  assert.deepEqual(again, stored);
  assert.deepEqual(await store.positions({ walletId, isPaper: false }, live()), [
    { ...moved.position, version: 1 },
  ]);
}

/** Refuses a departure write from a stale position or onto a paper one, and stores nothing. */
export async function refusesStaleDeparture(subject: PositionStoreSubject): Promise<void> {
  const { store } = subject;
  const [walletId] = subject.walletIds;
  const moved = await holding(subject);
  const stale = await store.recordDepartures(
    writeOf(subject, [{ ...moved, readVersion: 3 }]),
    live(),
  );
  assert.deepEqual(stale, { ok: false, error: "stale" });
  const paper = { position: { ...state(walletId, coin, 1n), isPaper: true } };
  await assert.rejects(store.recordDepartures(writeOf(subject, [paper]), live()), {
    code: "store.constraint",
  });
  await assertRefusesAborted(async (options) =>
    store.recordDepartures(writeOf(subject, [moved]), options),
  );
  assert.deepEqual(await store.positions({ walletId, isPaper: false }, live()), [
    { ...state(walletId, token, huge), version: 0 },
  ]);
  const later = await store.recordDepartures(writeOf(subject, [moved]), live());
  assert.ok(later.ok);
  assert.equal(later.value.length, 2);
}
