import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";
import { transactionProgressChecks } from "./transaction-progress-checks.js";
import {
  grant,
  signed,
  takeAndSave,
  type TransactionStoreSubject,
} from "./transaction-store-fixtures.js";

/** Makes a fresh, empty transaction store for each check. */
export interface TransactionStoreHarness {
  create(): Promise<TransactionStoreSubject>;
}

async function givesUntilHeld(subject: TransactionStoreSubject): Promise<void> {
  assert.deepEqual(await grant(subject, 5), { nonce: 5, refillsGap: false });
  assert.deepEqual(await grant(subject, 5), { nonce: 5, refillsGap: true });
  const saved = await subject.store.saveSigned(signed(subject, 1, 5), live());
  assert.deepEqual(saved, { ok: true, value: { ...signed(subject, 1, 5), state: "signed" } });
  assert.deepEqual(await grant(subject, 5), { nonce: 6, refillsGap: false });
}

async function refillsGaps(subject: TransactionStoreSubject): Promise<void> {
  const saved = await inOrder([1, 2, 3], async (n) => takeAndSave(subject, n, 5));
  assert.deepEqual(
    saved.map(({ nonce }) => nonce),
    [5, 6, 7],
  );
  assert.deepEqual(await grant(subject, 5), { nonce: 8, refillsGap: false });
  assert.deepEqual(await grant(subject, 5), { nonce: 8, refillsGap: true });
  await subject.setState(fixtureId("tx", 2), "dropped");
  assert.deepEqual(await grant(subject, 5), { nonce: 6, refillsGap: true });
  await subject.setState(fixtureId("tx", 1), "superseded");
  assert.deepEqual(await grant(subject, 5), { nonce: 5, refillsGap: true });
}

// The chain's count lags behind a block that holds nonce 7, so every nonce up to 7 is used.
async function staysAboveBlocks(subject: TransactionStoreSubject): Promise<void> {
  await inOrder([1, 2, 3], async (n) => takeAndSave(subject, n, 5));
  await subject.setState(fixtureId("tx", 2), "sent");
  await subject.setState(fixtureId("tx", 3), "included");
  assert.deepEqual(await grant(subject, 3), { nonce: 8, refillsGap: false });
  await subject.setState(fixtureId("tx", 3), "reverted");
  await subject.setState(fixtureId("tx", 1), "dropped");
  assert.deepEqual(await grant(subject, 3), { nonce: 8, refillsGap: true });
  await subject.setState(fixtureId("tx", 3), "final");
  assert.deepEqual(await grant(subject, 9), { nonce: 9, refillsGap: false });
}

async function followsTheChain(subject: TransactionStoreSubject): Promise<void> {
  assert.deepEqual(await grant(subject, 10), { nonce: 10, refillsGap: false });
  assert.deepEqual(await grant(subject, 20), { nonce: 20, refillsGap: false });
  await takeAndSave(subject, 1, 20);
  assert.deepEqual(await grant(subject, 21), { nonce: 21, refillsGap: false });
}

async function refusesTakenNonces(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  await inOrder([1, 2], async (n) => takeAndSave(subject, n, 5));
  await subject.setState(fixtureId("tx", 2), "sent");
  const taken = { ok: false, error: "nonce_taken" };
  assert.deepEqual(await store.saveSigned(signed(subject, 3, 6), live()), taken);
  assert.deepEqual(await grant(subject, 5), { nonce: 7, refillsGap: false });
  await subject.setState(fixtureId("tx", 2), "final");
  assert.deepEqual(await store.saveSigned(signed(subject, 3, 5), live()), taken);
  assert.deepEqual(await store.saveSigned(signed(subject, 3, 6), live()), taken);
  assert.ok((await store.saveSigned(signed(subject, 3, 7), live())).ok);
}

async function freesDroppedNonces(subject: TransactionStoreSubject): Promise<void> {
  await takeAndSave(subject, 1, 5);
  await subject.setState(fixtureId("tx", 1), "dropped");
  const again = await subject.store.saveSigned(signed(subject, 2, 5), live());
  assert.deepEqual(again, { ok: true, value: { ...signed(subject, 2, 5), state: "signed" } });
}

async function keepsAccountsApart(subject: TransactionStoreSubject): Promise<void> {
  await takeAndSave(subject, 1, 5);
  const other = subject.accounts[1];
  const request = { account: other, chainNonce: 5, atMs: 1 };
  assert.deepEqual(await subject.store.nextNonce(request, live()), { nonce: 5, refillsGap: false });
  const saved = await subject.store.saveSigned(
    { ...signed(subject, 2, 5), account: other },
    live(),
  );
  assert.ok(saved.ok);
  assert.deepEqual(await grant(subject, 5), { nonce: 6, refillsGap: false });
}

async function refusesUsedIds(subject: TransactionStoreSubject): Promise<void> {
  await takeAndSave(subject, 1, 5);
  await assert.rejects(subject.store.saveSigned(signed(subject, 1, 6), live()), {
    code: "store.constraint",
  });
  assert.deepEqual(await grant(subject, 5), { nonce: 6, refillsGap: false });
}

// Refills take ids below and above the dropped ones', so the rows of one nonce list by id. The
// limit cuts the last row.
async function listsByNonce(subject: TransactionStoreSubject): Promise<void> {
  const { store, accounts } = subject;
  const saved = await inOrder([1, 2, 3, 4], async (n) => takeAndSave(subject, n, 5));
  const [, second, third] = saved;
  assert.ok(second !== undefined && third !== undefined);
  await subject.setState(second.id, "dropped");
  await subject.setState(third.id, "dropped");
  const refills = await inOrder([0, 9], async (n) => takeAndSave(subject, n, 5));
  const page = await store.list({ account: accounts[0], fromNonce: 6, limit: 4 }, live());
  const expected: readonly TransactionRecord[] = [
    refills[0] ?? assert.fail("no first refill"),
    { ...second, state: "dropped" },
    { ...third, state: "dropped" },
    refills[1] ?? assert.fail("no second refill"),
  ];
  assert.deepEqual(page, expected);
  assert.deepEqual(await store.list({ account: accounts[1], fromNonce: 0, limit: 10 }, live()), []);
}

// Fixture transactions with an even number belong to the first intent, odd ones to the second.
async function listsByIntent(subject: TransactionStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const saved = await inOrder([4, 1, 2], async (n) => takeAndSave(subject, n, 5));
  const [four, one, two] = saved;
  assert.ok(four !== undefined && one !== undefined && two !== undefined);
  assert.deepEqual(await store.ofIntent(intentIds[0], live()), [two, four]);
  assert.deepEqual(await store.ofIntent(intentIds[1], live()), [one]);
  assert.deepEqual(await store.ofIntent(fixtureId("int", 99), live()), []);
}

async function refusesAborted(subject: TransactionStoreSubject): Promise<void> {
  const { store, accounts } = subject;
  const request = { account: accounts[0], chainNonce: 5, atMs: 1 };
  await assertRefusesAborted(async (call) => store.nextNonce(request, call));
  await assertRefusesAborted(async (call) => store.saveSigned(signed(subject, 1, 5), call));
  await assertRefusesAborted(async (call) =>
    store.list({ account: accounts[0], fromNonce: 0, limit: 1 }, call),
  );
  await assertRefusesAborted(async (call) => store.ofIntent(subject.intentIds[0], call));
  assert.deepEqual(await grant(subject, 5), { nonce: 5, refillsGap: false });
}

/** The contract every `TransactionStore` adapter passes. */
export function transactionStoreContract(
  harness: TransactionStoreHarness,
): readonly ContractCheck[] {
  const on = (name: string, run: (subject: TransactionStoreSubject) => Promise<void>) =>
    checkOn(name, async () => harness.create(), run);
  return [
    on("gives the same nonce until a signed transaction holds it", givesUntilHeld),
    on("gives a never signed or dropped nonce again before a new one", refillsGaps),
    on("never gives a nonce at or below one a block holds", staysAboveBlocks),
    on("follows the chain's count past nonces it never gave", followsTheChain),
    on("refuses to store a transaction at a nonce that is not free", refusesTakenNonces),
    on("stores a transaction at the nonce of a dropped one", freesDroppedNonces),
    on("keeps each account's nonces apart", keepsAccountsApart),
    on("throws store.constraint for an id in use and stores nothing", refusesUsedIds),
    on("lists one account's transactions by nonce, from a nonce up", listsByNonce),
    on("lists one intent's transactions by step", listsByIntent),
    on("changes nothing on an aborted signal", refusesAborted),
    ...transactionProgressChecks(async () => harness.create()),
  ];
}
