import assert from "node:assert/strict";
import type { RelayAnswer, TxReceipt } from "@binference/chain";
import type { Result } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";
import { hashOf, takeAndSave, type TransactionStoreSubject } from "./transaction-store-fixtures.js";

const wrongState = { ok: false, error: "wrong_state" } as const;

function receiptOf(n: number, block: bigint, status: TxReceipt["status"]): TxReceipt {
  return {
    hash: hashOf(n),
    block: { number: block, hash: `0x${block.toString(16).padStart(64, "0")}` },
    status,
    gasUsed: 2n ** 64n + 1n,
    feePerGasBase: 2n ** 64n + 3n,
  };
}

function valueOf(result: Result<TransactionRecord, string>): TransactionRecord {
  assert.ok(result.ok, "Expected the store to record the change.");
  return result.value;
}

async function recordsSends(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const { id } = await takeAndSave(subject, 1, 5);
  const first: readonly RelayAnswer[] = [
    { relay: "relay-a", outcome: "refused", reason: "underpriced", code: -32_000, atMs: 10 },
    { relay: "relay-b", outcome: "timed_out", atMs: 11 },
  ];
  const second: readonly RelayAnswer[] = [
    { relay: "relay-a", outcome: "accepted", atMs: 20 },
    { relay: "relay-b", outcome: "unreachable", atMs: 21 },
  ];
  const third: readonly RelayAnswer[] = [
    { relay: "relay-a", outcome: "accepted", atMs: 30 },
    { relay: "relay-b", outcome: "accepted", atMs: 31 },
  ];
  const unsent = valueOf(await store.recordSend({ id, answers: first }, live()));
  assert.deepEqual(
    [unsent.state, unsent.relays, unsent.sentAtMs],
    ["signed", ["relay-a", "relay-b"], undefined],
  );
  const sent = valueOf(await store.recordSend({ id, answers: second }, live()));
  assert.deepEqual([sent.state, sent.sentAtMs], ["sent", 20]);
  const again = valueOf(await store.recordSend({ id, answers: third }, live()));
  assert.deepEqual(
    [again.state, again.sentAtMs, again.relays],
    ["sent", 20, ["relay-a", "relay-b"]],
  );
  assert.deepEqual(await store.sends(id, live()), [...first, ...second, ...third]);
  assert.deepEqual(await store.sends(fixtureId("tx", 9), live()), []);
}

async function recordsBlocks(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const one = await takeAndSave(subject, 1, 5);
  const two = await takeAndSave(subject, 2, 5);
  const ran = receiptOf(1, 64_000_000n, "success");
  const included = valueOf(
    await store.recordReceipt({ id: one.id, receipt: ran, atMs: 40 }, live()),
  );
  assert.deepEqual(included, { ...one, state: "included", receipt: ran, includedAtMs: 40 });
  const final = valueOf(await store.recordFinal({ id: one.id, atMs: 50 }, live()));
  assert.deepEqual(final, { ...included, state: "final", finalAtMs: 50 });
  const failed = receiptOf(2, 9n, "reverted");
  const reverted = valueOf(
    await store.recordReceipt({ id: two.id, receipt: failed, atMs: 41 }, live()),
  );
  assert.deepEqual([reverted.state, reverted.receipt], ["reverted", failed]);
  const listed = await store.list(
    { account: subject.accounts[0], fromNonce: 0, limit: 10 },
    live(),
  );
  assert.deepEqual(listed, [final, reverted]);
}

async function followsReorgs(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const { id } = await takeAndSave(subject, 1, 5);
  valueOf(
    await store.recordSend(
      { id, answers: [{ relay: "relay-a", outcome: "accepted", atMs: 5 }] },
      live(),
    ),
  );
  valueOf(
    await store.recordReceipt({ id, receipt: receiptOf(1, 10n, "success"), atMs: 6 }, live()),
  );
  const back = valueOf(await store.recordReorg({ id, atMs: 7 }, live()));
  assert.deepEqual(
    [back.state, back.receipt, back.includedAtMs, back.sentAtMs],
    ["sent", undefined, undefined, 5],
  );
  const moved = receiptOf(1, 11n, "success");
  valueOf(
    await store.recordReceipt({ id, receipt: receiptOf(1, 10n, "success"), atMs: 8 }, live()),
  );
  const later = valueOf(await store.recordReceipt({ id, receipt: moved, atMs: 9 }, live()));
  assert.deepEqual([later.state, later.receipt, later.includedAtMs], ["included", moved, 9]);
}

async function refusesWrongStates(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const one = await takeAndSave(subject, 1, 5);
  const accepted: readonly RelayAnswer[] = [{ relay: "relay-a", outcome: "accepted", atMs: 1 }];
  assert.deepEqual(await store.recordFinal({ id: one.id, atMs: 1 }, live()), wrongState);
  assert.deepEqual(await store.recordReorg({ id: one.id, atMs: 1 }, live()), wrongState);
  valueOf(await store.recordSend({ id: one.id, answers: accepted }, live()));
  assert.deepEqual(await store.recordFinal({ id: one.id, atMs: 1 }, live()), wrongState);
  valueOf(
    await store.recordReceipt(
      { id: one.id, receipt: receiptOf(1, 3n, "success"), atMs: 2 },
      live(),
    ),
  );
  valueOf(await store.recordFinal({ id: one.id, atMs: 3 }, live()));
  assert.deepEqual(await store.recordSend({ id: one.id, answers: accepted }, live()), wrongState);
  assert.deepEqual(
    await store.recordReceipt(
      { id: one.id, receipt: receiptOf(1, 4n, "success"), atMs: 4 },
      live(),
    ),
    wrongState,
  );
  assert.deepEqual(await store.recordReorg({ id: one.id, atMs: 4 }, live()), wrongState);
  const two = await takeAndSave(subject, 2, 5);
  await subject.setState(two.id, "dropped");
  assert.deepEqual(await store.recordSend({ id: two.id, answers: accepted }, live()), wrongState);
  assert.deepEqual(await store.sends(two.id, live()), []);
}

async function refusesUnknown(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const id = fixtureId("tx", 7);
  const accepted: readonly RelayAnswer[] = [{ relay: "relay-a", outcome: "accepted", atMs: 1 }];
  const constraint = { code: "store.constraint" };
  await assert.rejects(store.recordSend({ id, answers: accepted }, live()), constraint);
  await assert.rejects(
    store.recordReceipt({ id, receipt: receiptOf(7, 1n, "success"), atMs: 1 }, live()),
    constraint,
  );
  await assert.rejects(store.recordFinal({ id, atMs: 1 }, live()), constraint);
  await assert.rejects(store.recordReorg({ id, atMs: 1 }, live()), constraint);
}

async function refusesAborted(subject: TransactionStoreSubject): Promise<void> {
  const { store } = subject;
  const { id } = await takeAndSave(subject, 1, 5);
  const answers: readonly RelayAnswer[] = [{ relay: "relay-a", outcome: "accepted", atMs: 1 }];
  await assertRefusesAborted(async (call) => store.recordSend({ id, answers }, call));
  await assertRefusesAborted(async (call) => store.sends(id, call));
  const receipt = receiptOf(1, 1n, "success");
  await assertRefusesAborted(async (call) => store.recordReceipt({ id, receipt, atMs: 1 }, call));
  await assertRefusesAborted(async (call) => store.recordFinal({ id, atMs: 1 }, call));
  await assertRefusesAborted(async (call) => store.recordReorg({ id, atMs: 1 }, call));
  const [stored] = await store.list(
    { account: subject.accounts[0], fromNonce: 0, limit: 1 },
    live(),
  );
  assert.equal(stored?.state, "signed");
  assert.deepEqual(await store.sends(id, live()), []);
}

/** The checks of what a transaction store records about each transaction's sends and blocks. */
export function transactionProgressChecks(
  create: () => Promise<TransactionStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn(
      "records each relay's answer, and moves to sent once one accepts",
      create,
      recordsSends,
    ),
    checkOn("records a receipt as included or reverted, then a final block", create, recordsBlocks),
    checkOn("moves a transaction back to sent when a reorg takes its block", create, followsReorgs),
    checkOn("refuses a move a transaction cannot make from its state", create, refusesWrongStates),
    checkOn(
      "throws store.constraint when a change names no stored transaction",
      create,
      refusesUnknown,
    ),
    checkOn("records nothing on an aborted signal", create, refusesAborted),
  ];
}
