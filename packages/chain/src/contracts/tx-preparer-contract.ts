import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { leastReplacementFee } from "../sending/least-replacement-fee.js";
import type { TxPreparer } from "../sending/ports.js";
import type { PreparedTx } from "../sending/prepared-tx.js";
import type { OriginalCall } from "../signing/sign-step.js";
import type { SignedTx, TxDraft, UnsignedTx } from "../transaction.js";

/** A transaction preparer under test: a draft that runs now and one that fails now. */
export interface TxPreparerSubject {
  readonly preparer: TxPreparer;
  readonly draft: TxDraft;
  readonly failing: TxDraft;
  /** The nonce an unsigned transaction carries, read back the family's way. */
  readonly nonceOf: (unsigned: UnsignedTx) => number;
  /** The call an unsigned transaction makes, as the signer's rule 6 compares calls. */
  readonly callOf: (unsigned: UnsignedTx) => OriginalCall;
  /** Signs an unsigned transaction as its sender. */
  readonly sign: (unsigned: UnsignedTx) => Promise<SignedTx>;
  /** `failing` signed at a nonce, as it was signed before its call began to fail. */
  readonly signFailing: (nonce: number) => Promise<SignedTx>;
}

/** Makes a fresh {@link TxPreparerSubject} whose chain has this network fee cap per gas. */
export interface TxPreparerHarness {
  create(feeCapBase: bigint): Promise<TxPreparerSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const noCap = 10n ** 30n;

async function preparedAt(subject: TxPreparerSubject, nonce: number): Promise<PreparedTx> {
  const prepared = await subject.preparer.prepare({ draft: subject.draft, nonce }, live());
  assert.ok(prepared.ok);
  return prepared.value;
}

async function preparesAtNonce(harness: TxPreparerHarness): Promise<void> {
  const subject = await harness.create(noCap);
  const { unsigned, feePerGasBase, isAboveFeeCap } = await preparedAt(subject, 7);
  const { draft, nonceOf } = subject;
  assert.deepEqual([unsigned.chain, unsigned.from], [draft.chain, draft.from]);
  assert.equal(nonceOf(unsigned), 7);
  assert.ok(feePerGasBase > 0n);
  assert.equal(isAboveFeeCap, false);
}

async function marksAboveCap(harness: TxPreparerHarness): Promise<void> {
  const subject = await harness.create(0n);
  assert.equal((await preparedAt(subject, 0)).isAboveFeeCap, true);
  const replaced = await subject.sign((await preparedAt(subject, 0)).unsigned);
  const request = { kind: "cancel", from: subject.draft.from, replaced } as const;
  const replacement = await subject.preparer.replace(request, live());
  assert.ok(replacement.ok);
  assert.equal(replacement.value.isAboveFeeCap, true);
}

async function refusesFailing(harness: TxPreparerHarness): Promise<void> {
  const { preparer, failing } = await harness.create(noCap);
  const prepared = await preparer.prepare({ draft: failing, nonce: 0 }, live());
  assert.deepEqual(prepared, { ok: false, error: "would_fail" });
}

async function refusesAborted(harness: TxPreparerHarness): Promise<void> {
  const subject = await harness.create(noCap);
  const { preparer, draft } = subject;
  const reason = new Error("stopped");
  await assert.rejects(
    preparer.prepare({ draft, nonce: 0 }, { signal: AbortSignal.abort(reason) }),
    reason,
  );
  const replaced = await subject.sign((await preparedAt(subject, 0)).unsigned);
  const request = { kind: "speedUp", from: draft.from, replaced } as const;
  await assert.rejects(preparer.replace(request, { signal: AbortSignal.abort(reason) }), reason);
}

async function speedsUp(harness: TxPreparerHarness): Promise<void> {
  const subject = await harness.create(noCap);
  const first = await preparedAt(subject, 7);
  const replaced = await subject.sign(first.unsigned);
  const request = { kind: "speedUp", from: subject.draft.from, replaced } as const;
  const replacement = await subject.preparer.replace(request, live());
  assert.ok(replacement.ok);
  const { unsigned, feePerGasBase, replaces } = replacement.value;
  const original = subject.callOf(first.unsigned);
  assert.deepEqual([unsigned.chain, unsigned.from], [first.unsigned.chain, first.unsigned.from]);
  assert.equal(subject.nonceOf(unsigned), 7);
  assert.deepEqual(subject.callOf(unsigned), original);
  assert.ok(feePerGasBase >= leastReplacementFee(first.feePerGasBase));
  assert.deepEqual(replaces, { kind: "speedUp", nonce: 7, original });
}

async function cancels(harness: TxPreparerHarness): Promise<void> {
  const subject = await harness.create(noCap);
  const { draft, preparer } = subject;
  const replaced = await subject.signFailing(4);
  const speedUp = await preparer.replace({ kind: "speedUp", from: draft.from, replaced }, live());
  assert.deepEqual(speedUp, { ok: false, error: "would_fail" });
  const cancel = await preparer.replace({ kind: "cancel", from: draft.from, replaced }, live());
  assert.ok(cancel.ok);
  const { unsigned, replaces } = cancel.value;
  assert.equal(subject.nonceOf(unsigned), 4);
  assert.deepEqual(subject.callOf(unsigned), { to: draft.from, value: 0n, data: "0x" });
  assert.deepEqual(replaces, { kind: "cancel", nonce: 4 });
  const first = await preparedAt(subject, 4);
  const again = await subject.sign(first.unsigned);
  const raised = await preparer.replace(
    { kind: "cancel", from: draft.from, replaced: again },
    live(),
  );
  assert.ok(raised.ok);
  assert.ok(raised.value.feePerGasBase >= leastReplacementFee(first.feePerGasBase));
}

/** The contract every `TxPreparer` adapter passes. */
export function txPreparerContract(harness: TxPreparerHarness): readonly ContractCheck[] {
  return [
    {
      name: "prepares a draft from its sender on its chain at the nonce it is given",
      run: async () => preparesAtNonce(harness),
    },
    {
      name: "marks fees above the chain's network fee cap",
      run: async () => marksAboveCap(harness),
    },
    {
      name: "answers would_fail for a draft that fails now",
      run: async () => refusesFailing(harness),
    },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => refusesAborted(harness),
    },
    {
      name: "speeds a signed transaction up at its nonce, its call kept, for at least 10% more",
      run: async () => speedsUp(harness),
    },
    {
      name: "cancels at a nonce with a 0-value transfer to the sender, even when the call fails now",
      run: async () => cancels(harness),
    },
  ];
}
