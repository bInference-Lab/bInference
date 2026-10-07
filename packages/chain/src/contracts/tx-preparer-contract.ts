import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { TxPreparer } from "../sending/ports.js";
import type { TxDraft, UnsignedTx } from "../transaction.js";

/** A transaction preparer under test: a draft that runs now and one that fails now. */
export interface TxPreparerSubject {
  readonly preparer: TxPreparer;
  readonly draft: TxDraft;
  readonly failing: TxDraft;
  /** The nonce an unsigned transaction carries, read back the family's way. */
  readonly nonceOf: (unsigned: UnsignedTx) => number;
}

/** Makes a fresh {@link TxPreparerSubject} whose chain has this network fee cap per gas. */
export interface TxPreparerHarness {
  create(feeCapBase: bigint): Promise<TxPreparerSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const noCap = 10n ** 30n;

async function preparesAtNonce(harness: TxPreparerHarness): Promise<void> {
  const { preparer, draft, nonceOf } = await harness.create(noCap);
  const prepared = await preparer.prepare({ draft, nonce: 7 }, live());
  assert.ok(prepared.ok);
  const { unsigned, feePerGasBase, isAboveFeeCap } = prepared.value;
  assert.deepEqual([unsigned.chain, unsigned.from], [draft.chain, draft.from]);
  assert.equal(nonceOf(unsigned), 7);
  assert.ok(feePerGasBase > 0n);
  assert.equal(isAboveFeeCap, false);
}

async function marksAboveCap(harness: TxPreparerHarness): Promise<void> {
  const { preparer, draft } = await harness.create(0n);
  const prepared = await preparer.prepare({ draft, nonce: 0 }, live());
  assert.ok(prepared.ok);
  assert.equal(prepared.value.isAboveFeeCap, true);
}

async function refusesFailing(harness: TxPreparerHarness): Promise<void> {
  const { preparer, failing } = await harness.create(noCap);
  const prepared = await preparer.prepare({ draft: failing, nonce: 0 }, live());
  assert.deepEqual(prepared, { ok: false, error: "would_fail" });
}

async function refusesAborted(harness: TxPreparerHarness): Promise<void> {
  const { preparer, draft } = await harness.create(noCap);
  const reason = new Error("stopped");
  await assert.rejects(
    preparer.prepare({ draft, nonce: 0 }, { signal: AbortSignal.abort(reason) }),
    reason,
  );
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
  ];
}
