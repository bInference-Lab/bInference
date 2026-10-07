import assert from "node:assert/strict";
import { type AssetRef, assetRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ArrivalDraft, PaperReset } from "../positions/arrival-record.js";
import type { PositionState } from "../positions/position-record.js";
import type { PositionStoreSubject } from "./position-store-contract.js";
import { assertRefusesAborted, live } from "./store-fixtures.js";

const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:a");
const other = assetRefSchema.parse("fake:1/token:b");
// Above 2^64, so an adapter that stores amounts as 64-bit integers fails.
const huge = 18_446_744_073_709_551_617n;

function paper(walletId: Id<"wal">, asset: AssetRef, quantityBase: bigint): PositionState {
  return {
    walletId,
    asset,
    isPaper: true,
    quantityBase,
    costUsdMicros: quantityBase,
    realizedUsdMicros: 0n,
    changedAtMs: 2_000,
  };
}

function starting(walletId: Id<"wal">, received: bigint): ArrivalDraft {
  return {
    walletId,
    isPaper: true,
    atMs: 2_000,
    received: { asset: coin, base: received },
    valueUsdMicros: received,
  };
}

// The wallet holds a paper token, a paper coin it sold out of, and a live token.
async function held(subject: PositionStoreSubject): Promise<Id<"wal">> {
  const [walletId] = subject.walletIds;
  const opened = { ...starting(walletId, 7n), received: { asset: token, base: 7n } };
  await subject.store.recordArrival(
    { arrival: opened, positions: [{ position: paper(walletId, token, 7n) }] },
    live(),
  );
  const liveToken = { position: { ...paper(walletId, token, 7n), isPaper: false } };
  await subject.store.recordArrival(
    { arrival: { ...opened, isPaper: false }, positions: [liveToken] },
    live(),
  );
  const emptied = { ...opened, received: { asset: other, base: 1n } };
  await subject.store.recordArrival(
    { arrival: emptied, positions: [{ position: paper(walletId, other, 0n) }] },
    live(),
  );
  return walletId;
}

function resetOf(walletId: Id<"wal">): PaperReset {
  return {
    walletId,
    arrivals: [starting(walletId, huge)],
    positions: [
      { position: paper(walletId, coin, huge) },
      { position: paper(walletId, other, 0n), readVersion: 0 },
      { position: paper(walletId, token, 0n), readVersion: 0 },
    ],
  };
}

/** A reset empties the wallet's paper positions, opens the new ones and stores the arrivals. */
export async function resetsPaper(subject: PositionStoreSubject): Promise<void> {
  const walletId = await held(subject);
  const reset = await subject.store.resetPaper(resetOf(walletId), live());
  assert.ok(reset.ok);
  assert.deepEqual(reset.value, [{ ...starting(walletId, huge), id: reset.value[0]?.id }]);
  assert.deepEqual(await subject.store.positions({ walletId, isPaper: true }, live()), [
    { ...paper(walletId, coin, huge), version: 0 },
    { ...paper(walletId, token, 0n), version: 1 },
    { ...paper(walletId, other, 0n), version: 1 },
  ]);
  const kept = await subject.store.positions({ walletId, isPaper: false }, live());
  assert.deepEqual(kept, [{ ...paper(walletId, token, 7n), isPaper: false, version: 0 }]);
  const page = { after: 0, limit: 10, isPaper: true, walletId };
  assert.equal((await subject.store.arrivals(page, live())).length, 3);
}

/** A reset that misses a position, or read one at an older version, stores nothing. */
export async function refusesStaleReset(subject: PositionStoreSubject): Promise<void> {
  const walletId = await held(subject);
  const reset = resetOf(walletId);
  const missing = { ...reset, positions: reset.positions.slice(0, 2) };
  assert.deepEqual(await subject.store.resetPaper(missing, live()), { ok: false, error: "stale" });
  const older = {
    ...reset,
    positions: [...missing.positions, { position: paper(walletId, token, 0n) }],
  };
  assert.deepEqual(await subject.store.resetPaper(older, live()), { ok: false, error: "stale" });
  const twice = [{ position: paper(walletId, coin, 1n) }, { position: paper(walletId, coin, 2n) }];
  await assert.rejects(
    subject.store.resetPaper(
      { ...reset, positions: [...reset.positions.slice(1), ...twice] },
      live(),
    ),
    { code: "store.constraint" },
  );
  const [, otherWallet] = subject.walletIds;
  const foreign = { ...reset, arrivals: [starting(otherWallet, 1n)] };
  await assert.rejects(subject.store.resetPaper(foreign, live()), { code: "store.constraint" });
  const liveArrival = { ...reset, arrivals: [{ ...starting(walletId, 1n), isPaper: false }] };
  await assert.rejects(subject.store.resetPaper(liveArrival, live()), { code: "store.constraint" });
  await assertRefusesAborted(async (options) => subject.store.resetPaper(reset, options));
  const positions = await subject.store.positions({ walletId, isPaper: true }, live());
  assert.deepEqual(
    positions.map((position) => [position.asset, position.version]),
    [
      [token, 0],
      [other, 0],
    ],
  );
}
