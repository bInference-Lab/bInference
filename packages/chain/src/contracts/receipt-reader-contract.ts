import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { ChainRef } from "../caip/chain-ref.js";
import type { ReceiptReader } from "../sending/ports.js";
import type { TxHash } from "../transaction.js";

/**
 * A receipt reader under test, on one chain: a transaction a block holds that ran, one a block
 * holds that reverted, and a hash no block holds.
 */
export interface ReceiptReaderSubject {
  readonly reader: ReceiptReader;
  readonly chain: ChainRef;
  readonly succeeded: TxHash;
  readonly reverted: TxHash;
  readonly unknown: TxHash;
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

async function refusesAborted(harness: ReceiptReaderHarness): Promise<void> {
  const { reader, chain, succeeded } = await harness.create();
  const reason = new Error("stopped");
  const aborted = { signal: AbortSignal.abort(reason) };
  await assert.rejects(reader.receipt(chain, succeeded, aborted), reason);
  await assert.rejects(reader.head(chain, aborted), reason);
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
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => refusesAborted(harness),
    },
  ];
}
