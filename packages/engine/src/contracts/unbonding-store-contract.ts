import assert from "node:assert/strict";
import { accountRefSchema, assetRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { UnbondingStore } from "../staking/ports.js";
import type { UnbondingClaim, UnbondingDraft } from "../staking/unbonding-record.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** A fresh, empty unbonding store, three intents it holds and their wallet. */
export interface UnbondingStoreSubject {
  readonly store: UnbondingStore;
  readonly intentIds: readonly [Id<"int">, Id<"int">, Id<"int">];
  readonly walletId: Id<"wal">;
}

/** Makes a fresh {@link UnbondingStoreSubject} for each check. */
export interface UnbondingStoreHarness {
  create(): Promise<UnbondingStoreSubject>;
}

const huge = 2n ** 64n + 1n;
const readyAtMs = 1_800_000_000_000;
const validator = accountRefSchema.parse("fake:1:0x000000c1");

function draftOf(
  subject: UnbondingStoreSubject,
  intentId: Id<"int">,
  change: Partial<UnbondingDraft> = {},
): UnbondingDraft {
  return {
    intentId,
    walletId: subject.walletId,
    venue: "fake-staking",
    validator,
    requestRef: `ref-${intentId}`,
    amount: { asset: assetRefSchema.parse("fake:1/slip44:1"), base: huge },
    valueUsdMicros: huge,
    readyAtMs,
    isPaper: false,
    ...change,
  };
}

function claimOf(
  subject: UnbondingStoreSubject,
  claimIntentId: Id<"int">,
  requestRefs: readonly string[],
): UnbondingClaim {
  const { walletId } = subject;
  return {
    walletId,
    isPaper: false,
    venue: "fake-staking",
    validator,
    claimIntentId,
    requestRefs,
    atMs: 7,
  };
}

async function opensOnce(subject: UnbondingStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const draft = draftOf(subject, intentIds[0]);
  const opened = await store.open(draft, live());
  assert.deepEqual(opened, { ...draft, id: opened.id });
  const again = await store.open(draftOf(subject, intentIds[0], { requestRef: "other" }), live());
  assert.deepEqual(again, opened);
  await assert.rejects(
    store.open(draftOf(subject, intentIds[1], { requestRef: draft.requestRef }), live()),
    { code: "store.constraint" },
  );
  await assert.rejects(store.open(draftOf(subject, fixtureId("int", 99)), live()), {
    code: "store.constraint",
  });
}

async function listsOpenSoonestFirst(subject: UnbondingStoreSubject): Promise<void> {
  const { store, intentIds, walletId } = subject;
  const later = await store.open(
    draftOf(subject, intentIds[0], { readyAtMs: readyAtMs + 1 }),
    live(),
  );
  const sooner = await store.open(draftOf(subject, intentIds[1]), live());
  await store.open(draftOf(subject, intentIds[2], { isPaper: true }), live());
  const query = { walletId, isPaper: false, venue: "fake-staking", validator };
  assert.deepEqual(await store.listOpen(query, live()), [sooner, later]);
  const elsewhere = { ...query, validator: accountRefSchema.parse("fake:1:0x000000c2") };
  assert.deepEqual(await store.listOpen(elsewhere, live()), []);
}

async function listsWalletOpen(subject: UnbondingStoreSubject): Promise<void> {
  const { store, intentIds, walletId } = subject;
  const other = accountRefSchema.parse("fake:1:0x000000c2");
  const later = await store.open(
    draftOf(subject, intentIds[0], { readyAtMs: readyAtMs + 1, validator: other }),
    live(),
  );
  const sooner = await store.open(
    draftOf(subject, intentIds[1], { venue: "other-staking" }),
    live(),
  );
  const paper = await store.open(draftOf(subject, intentIds[2], { isPaper: true }), live());
  assert.deepEqual(await store.openOf({ walletId, isPaper: false }, live()), [sooner, later]);
  assert.deepEqual(await store.openOf({ walletId, isPaper: true }, live()), [paper]);
  const claim = { ...claimOf(subject, intentIds[2], [paper.requestRef]), isPaper: true };
  await store.claim(claim, live());
  assert.deepEqual(await store.openOf({ walletId, isPaper: true }, live()), []);
  const elsewhere = { walletId: fixtureId("wal", 98), isPaper: false };
  assert.deepEqual(await store.openOf(elsewhere, live()), []);
}

async function claimsOnce(subject: UnbondingStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const first = await store.open(draftOf(subject, intentIds[0]), live());
  const second = await store.open(draftOf(subject, intentIds[1]), live());
  const taken = await store.claim(
    claimOf(subject, intentIds[2], [first.requestRef, "unknown"]),
    live(),
  );
  const claimed = { ...first, claimIntentId: intentIds[2], claimedAtMs: 7 };
  assert.deepEqual(taken, { ok: true, value: [claimed] });
  const again = await store.claim(claimOf(subject, intentIds[2], [first.requestRef]), live());
  assert.deepEqual(again, { ok: true, value: [claimed] });
  const other = await store.claim(claimOf(subject, intentIds[1], [first.requestRef]), live());
  assert.deepEqual(other, { ok: false, error: "taken" });
  assert.deepEqual(await store.claimedBy(intentIds[2], live()), [claimed]);
  const query = { walletId: subject.walletId, isPaper: false, venue: "fake-staking", validator };
  assert.deepEqual(await store.listOpen(query, live()), [second]);
  const stranger = claimOf(subject, fixtureId("int", 99), [second.requestRef]);
  await assert.rejects(store.claim(stranger, live()), { code: "store.constraint" });
  assert.deepEqual(await store.listOpen(query, live()), [second]);
}

async function tellsReadyOnce(subject: UnbondingStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const ready = await store.open(draftOf(subject, intentIds[0]), live());
  await store.open(draftOf(subject, intentIds[1], { readyAtMs: readyAtMs + 1 }), live());
  const claimed = await store.open(draftOf(subject, intentIds[2], { isPaper: true }), live());
  await store.claim(
    { ...claimOf(subject, intentIds[2], [claimed.requestRef]), isPaper: true },
    live(),
  );
  const now = { nowMs: readyAtMs, limit: 10 };
  assert.deepEqual(await store.untoldReady(now, live()), [ready]);
  await store.markTold({ ids: [ready.id], atMs: 9 }, live());
  await store.markTold({ ids: [ready.id], atMs: 11 }, live());
  assert.deepEqual(await store.untoldReady(now, live()), []);
  const query = { walletId: subject.walletId, isPaper: false, venue: "fake-staking", validator };
  const [told] = await store.listOpen(query, live());
  assert.deepEqual(told, { ...ready, toldReadyAtMs: 9 });
}

async function closesOutsideOnce(subject: UnbondingStoreSubject): Promise<void> {
  const { store, intentIds, walletId } = subject;
  const query = { walletId, isPaper: false, venue: "fake-staking", validator };
  const open = await store.open(draftOf(subject, intentIds[0]), live());
  const claimed = await store.open(draftOf(subject, intentIds[1]), live());
  await store.claim(claimOf(subject, intentIds[2], [claimed.requestRef]), live());
  const closed = await store.closeOutside({ id: open.id, atMs: 9 }, live());
  assert.deepEqual(closed, { ok: true, value: { ...open, closedOutsideAtMs: 9 } });
  assert.deepEqual(await store.closeOutside({ id: open.id, atMs: 10 }, live()), {
    ok: false,
    error: "taken",
  });
  assert.deepEqual(await store.closeOutside({ id: claimed.id, atMs: 10 }, live()), {
    ok: false,
    error: "taken",
  });
  assert.deepEqual(await store.listOpen(query, live()), []);
  assert.deepEqual(await store.openOf({ walletId, isPaper: false }, live()), []);
  assert.deepEqual(await store.untoldReady({ nowMs: readyAtMs, limit: 10 }, live()), []);
  const late = await store.claim(claimOf(subject, intentIds[1], [open.requestRef]), live());
  assert.deepEqual(late, { ok: false, error: "taken" });
}

async function refusesAborted(subject: UnbondingStoreSubject): Promise<void> {
  const { store, intentIds, walletId } = subject;
  const query = { walletId, isPaper: false, venue: "fake-staking", validator };
  await assertRefusesAborted(async (call) => store.open(draftOf(subject, intentIds[0]), call));
  await assertRefusesAborted(async (call) => store.listOpen(query, call));
  await assertRefusesAborted(async (call) => store.openOf({ walletId, isPaper: false }, call));
  await assertRefusesAborted(async (call) => store.claimedBy(intentIds[0], call));
  await assertRefusesAborted(async (call) =>
    store.claim(claimOf(subject, intentIds[0], ["ref"]), call),
  );
  await assertRefusesAborted(async (call) => store.untoldReady({ nowMs: 0, limit: 1 }, call));
  await assertRefusesAborted(async (call) => store.markTold({ ids: [], atMs: 0 }, call));
  await assertRefusesAborted(async (call) => store.closeOutside({ id: 1, atMs: 0 }, call));
}

/** The contract every `UnbondingStore` passes. */
export function unbondingStoreContract(harness: UnbondingStoreHarness): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn(
      "opens an unstake's unbonding once, and refuses a request held or an unknown intent",
      create,
      opensOnce,
    ),
    checkOn(
      "lists one wallet's open unbondings of a validator in a mode, soonest ready first",
      create,
      listsOpenSoonestFirst,
    ),
    checkOn(
      "lists one wallet's open unbondings of every venue and validator in a mode, soonest ready first",
      create,
      listsWalletOpen,
    ),
    checkOn(
      "marks the requests a claim took once, and refuses one another or an unknown intent took",
      create,
      claimsOnce,
    ),
    checkOn(
      "lists the ready unbondings no claim took that the owner was not told of, and marks each once",
      create,
      tellsReadyOnce,
    ),
    checkOn(
      "closes an open unbonding claimed outside binference once, which no list or claim holds after",
      create,
      closesOutsideOnce,
    ),
    checkOn("refuses every call on an aborted signal", create, refusesAborted),
  ];
}
