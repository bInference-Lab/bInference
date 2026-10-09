import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AccountRef } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { ReceiptReader } from "../sending/ports.js";
import type { AssetTransfer } from "../simulation/simulated-step.js";
import type { TxHash } from "../transaction.js";

/**
 * A receipt reader under test, on one chain: a transaction a block holds that ran, with the
 * transfers it made, one a block holds that reverted, and a hash no block holds. `sender` sent
 * both, at nonces 0 and 1, the first in a block below the second's.
 */
export interface ReceiptReaderSubject {
  readonly reader: ReceiptReader;
  readonly chain: ChainRef;
  readonly succeeded: TxHash;
  readonly succeededTransfers: readonly AssetTransfer[];
  readonly reverted: TxHash;
  readonly unknown: TxHash;
  readonly sender: AccountRef;
  /** The native coin `sender` received without a log in the block that holds `succeeded`. */
  readonly nativeReceived: bigint;
  /** A block whose state the reader no longer holds. */
  readonly stateGone: bigint;
}

/** Makes a fresh {@link ReceiptReaderSubject} for each check. */
export interface ReceiptReaderHarness {
  create(): Promise<ReceiptReaderSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

async function readsSuccess(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain, succeeded } = await harness.create();
  const receipt = await reader.receipt(chain, succeeded, live());
  const head = await reader.head(chain, live());
  assert.equal(receipt?.hash, succeeded);
  assert.equal(receipt.status, "success");
  assert.ok(receipt.block.number <= head.latest);
  assert.ok(receipt.gasUsed > 0n);
}

async function readsRevert(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain, reverted } = await harness.create();
  const receipt = await reader.receipt(chain, reverted, live());
  assert.equal(receipt?.status, "reverted");
  assert.equal(receipt.hash, reverted);
}

async function readsNothing(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain, unknown } = await harness.create();
  assert.equal(await reader.receipt(chain, unknown, live()), undefined);
}

async function readsHead(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain } = await harness.create();
  const head = await reader.head(chain, live());
  assert.ok(head.final <= head.latest);
  assert.ok(head.final >= 0n);
}

async function readsTransfers(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain, succeeded, succeededTransfers, reverted, unknown } =
    await harness.create();
  assert.deepEqual(await reader.transfers(chain, succeeded, live()), succeededTransfers);
  assert.deepEqual(await reader.transfers(chain, reverted, live()), []);
  assert.equal(await reader.transfers(chain, unknown, live()), undefined);
}

async function readsNonces(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain, succeeded, reverted, sender } = await harness.create();
  const first = await reader.receipt(chain, succeeded, live());
  const second = await reader.receipt(chain, reverted, live());
  assert.ok(first !== undefined && second !== undefined);
  assert.equal(await reader.nonceAt(sender, first.block.number - 1n, live()), 0);
  assert.equal(await reader.nonceAt(sender, first.block.number, live()), 1);
  assert.equal(await reader.nonceAt(sender, second.block.number, live()), 2);
}

async function readsNativeReceived(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain, succeeded, sender, nativeReceived, stateGone } = await harness.create();
  const receipt = await reader.receipt(chain, succeeded, live());
  assert.ok(receipt !== undefined);
  const received = await reader.nativeReceived(sender, receipt.block.number, live());
  assert.deepEqual(received, { ok: true, value: nativeReceived });
  const gone = await reader.nativeReceived(sender, stateGone, live());
  assert.deepEqual(gone, { ok: false, error: "state_gone" });
}

async function refusesAborted(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain, succeeded, sender } = await harness.create();
  const reason = new Error("stopped");
  const aborted = { signal: AbortSignal.abort(reason) };
  await assert.rejects(reader.receipt(chain, succeeded, aborted), reason);
  await assert.rejects(reader.head(chain, aborted), reason);
  await assert.rejects(reader.transfers(chain, succeeded, aborted), reason);
  await assert.rejects(reader.nonceAt(sender, 0n, aborted), reason);
  await assert.rejects(reader.nativeReceived(sender, 1n, aborted), reason);
}

/** The contract every `ReceiptReader` adapter passes. */
export function receiptReaderContract(harness: ReceiptReaderHarness): readonly ContractCheck[] {
  return [
    {
      name: "reads the receipt of a transaction a block holds",
      run: async () => readsSuccess(harness),
    },
    { name: "reads a reverted transaction as reverted", run: async () => readsRevert(harness) },
    {
      name: "reads no receipt for a transaction no block holds",
      run: async () => readsNothing(harness),
    },
    {
      name: "reads the chain's head with its final block at or below the latest",
      run: async () => readsHead(harness),
    },
    {
      name: "reads what a transaction a block holds moved, and nothing for one that reverted",
      run: async () => readsTransfers(harness),
    },
    {
      name: "counts an account's transactions in the blocks up to a block",
      run: async () => readsNonces(harness),
    },
    {
      name: "reads the native coin an account received in a block, or that its state is gone",
      run: async () => readsNativeReceived(harness),
    },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => refusesAborted(harness),
    },
  ];
}
