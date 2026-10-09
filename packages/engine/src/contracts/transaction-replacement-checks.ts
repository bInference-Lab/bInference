import assert from "node:assert/strict";
import type { RelayAnswer } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";
import {
  grant,
  receiptOf,
  replacementOf,
  takeAndSave,
  type TransactionStoreSubject,
  valueOf,
} from "./transaction-store-fixtures.js";

const accepted: readonly RelayAnswer[] = [{ relay: "relay-a", outcome: "accepted", atMs: 1 }];

async function sentAt(subject: TransactionStoreSubject, n: number, chainNonce: number) {
  const { id } = await takeAndSave(subject, n, chainNonce);
  return valueOf(await subject.store.recordSend({ id, answers: accepted }, live()));
}

async function storesReplacements(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const first = await sentAt(subject, 2, 5);
  const speedUp = replacementOf(4, first, "speedUp");
  assert.deepEqual(await store.saveReplacement(speedUp, live()), {
    ok: true,
    value: { ...speedUp, state: "signed" },
  });
  assert.deepEqual(await grant(subject, 5), { nonce: 6, refillsGap: false });
  const again = replacementOf(6, first, "cancel");
  assert.deepEqual(await store.saveReplacement(again, live()), { ok: false, error: "wrong_state" });
  const cancel = replacementOf(8, { ...speedUp, state: "signed" }, "cancel");
  valueOf(await store.saveReplacement(cancel, live()));
  const states = (await store.ofIntent(first.intentId, live())).map(({ id, state }) => [id, state]);
  assert.deepEqual(states, [
    [first.id, "superseded"],
    [speedUp.id, "superseded"],
    [cancel.id, "signed"],
  ]);
}

async function refusesStrangers(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const first = await takeAndSave(subject, 1, 5);
  const later = await takeAndSave(subject, 3, 5);
  const constraint = { code: "store.constraint" };
  const elsewhere = { ...replacementOf(5, first, "speedUp"), nonce: 7 };
  await assert.rejects(store.saveReplacement(elsewhere, live()), constraint);
  const unknown = replacementOf(5, { ...first, id: fixtureId("tx", 9) }, "cancel");
  await assert.rejects(store.saveReplacement(unknown, live()), constraint);
  await assert.rejects(
    store.saveReplacement(replacementOf(3, first, "cancel"), live()),
    constraint,
  );
  await subject.setState(later.id, "included");
  const taken = await store.saveReplacement(replacementOf(5, first, "cancel"), live());
  assert.deepEqual(taken, { ok: false, error: "nonce_taken" });
  const [stored] = await store.ofIntent(first.intentId, live());
  assert.equal(stored?.state, "signed");
}

async function settlesTheNonce(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const first = await sentAt(subject, 2, 5);
  const speedUp = valueOf(await store.saveReplacement(replacementOf(4, first, "speedUp"), live()));
  const ran = receiptOf(2, 30n, "success");
  const landed = valueOf(
    await store.recordReceipt({ id: first.id, receipt: ran, atMs: 9 }, live()),
  );
  assert.deepEqual(landed, { ...first, state: "included", receipt: ran, includedAtMs: 9 });
  const listed = await store.ofIntent(first.intentId, live());
  assert.deepEqual(listed, [landed, { ...speedUp, state: "superseded" }]);
  assert.deepEqual(await grant(subject, 5), { nonce: 6, refillsGap: false });
}

async function marksSuperseded(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const first = await takeAndSave(subject, 1, 5);
  const marked = valueOf(await store.recordSuperseded({ id: first.id, atMs: 3 }, live()));
  assert.deepEqual(marked, { ...first, state: "superseded" });
  const wrongState = { ok: false, error: "wrong_state" };
  assert.deepEqual(await store.recordSuperseded({ id: first.id, atMs: 4 }, live()), wrongState);
  await assert.rejects(store.recordSuperseded({ id: fixtureId("tx", 9), atMs: 4 }, live()), {
    code: "store.constraint",
  });
}

async function refusesAborted(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const first = await takeAndSave(subject, 2, 5);
  const speedUp = replacementOf(4, first, "speedUp");
  await assertRefusesAborted(async (call) => store.saveReplacement(speedUp, call));
  await assertRefusesAborted(async (call) =>
    store.recordSuperseded({ id: first.id, atMs: 1 }, call),
  );
  const listed = await store.ofIntent(first.intentId, live());
  assert.deepEqual(listed, [first]);
}

/** The checks of how a transaction store keeps a stuck step's replacements at its nonce. */
export function transactionReplacementChecks(
  create: () => Promise<TransactionStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn(
      "stores a replacement at its step's nonce, superseding the one before",
      create,
      storesReplacements,
    ),
    checkOn(
      "refuses a replacement of another step, nonce or id, or at a nonce a block holds",
      create,
      refusesStrangers,
    ),
    checkOn(
      "records a superseded transaction's receipt and supersedes its rivals",
      create,
      settlesTheNonce,
    ),
    checkOn(
      "marks a signed or sent transaction superseded, and nothing else",
      create,
      marksSuperseded,
    ),
    checkOn("stores and marks nothing on an aborted signal", create, refusesAborted),
  ];
}
