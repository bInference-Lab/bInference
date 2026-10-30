import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { Amount } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";
import type { DeliveryRequest } from "../delivery/delivery.js";
import type { DeliveryReader } from "../delivery/ports.js";
import type { TxHash } from "../transaction.js";

/**
 * A delivery reader under test, on one chain: `recipient` holds `holding.base` of
 * `holding.asset`, and `delivered`, which a final block holds, brought it `received`; `failed`
 * ran and failed while sending it `received.asset`; no block holds `unknown`; `stranger` is an
 * account of another chain.
 */
export interface DeliveryReaderSubject {
  readonly reader: DeliveryReader;
  readonly recipient: AccountRef;
  readonly holding: Amount;
  readonly delivered: TxHash;
  readonly received: Amount;
  readonly failed: TxHash;
  readonly unknown: TxHash;
  readonly stranger: AccountRef;
}

/** Makes a fresh {@link DeliveryReaderSubject} for each check. */
export interface DeliveryReaderHarness {
  create(): Promise<DeliveryReaderSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function requestOf(subject: DeliveryReaderSubject, hash: TxHash): DeliveryRequest {
  return { hash, recipient: subject.recipient, asset: subject.received.asset };
}

async function readsBalance(harness: DeliveryReaderHarness): Promise<void> {
  const { reader, recipient, holding } = await harness.create();
  assert.equal(await reader.balance(recipient, holding.asset, live()), holding.base);
}

async function readsDelivery(harness: DeliveryReaderHarness): Promise<void> {
  const subject = await harness.create();
  const { reader, delivered, received } = subject;
  const delivery = await reader.delivery(requestOf(subject, delivered), live());
  assert.equal(delivery?.hash, delivered);
  assert.equal(delivery.status, "success");
  assert.equal(delivery.final, true);
  assert.ok(delivery.block > 0n);
  assert.deepEqual(delivery.received, received);
  assert.ok(received.base > 0n);
}

async function readsFailure(harness: DeliveryReaderHarness): Promise<void> {
  const subject = await harness.create();
  const delivery = await subject.reader.delivery(requestOf(subject, subject.failed), live());
  assert.equal(delivery?.status, "failed");
  assert.deepEqual(delivery.received, { asset: subject.received.asset, base: 0n });
}

async function readsNothing(harness: DeliveryReaderHarness): Promise<void> {
  const subject = await harness.create();
  assert.equal(
    await subject.reader.delivery(requestOf(subject, subject.unknown), live()),
    undefined,
  );
}

async function refusesStranger(harness: DeliveryReaderHarness): Promise<void> {
  const subject = await harness.create();
  const { reader, stranger, holding, delivered, received } = subject;
  await assert.rejects(reader.balance(stranger, holding.asset, live()));
  const request = { hash: delivered, recipient: stranger, asset: received.asset };
  await assert.rejects(reader.delivery(request, live()));
}

async function refusesAborted(harness: DeliveryReaderHarness): Promise<void> {
  const subject = await harness.create();
  const { reader, recipient, holding, delivered } = subject;
  const reason = new Error("stopped");
  const aborted = { signal: AbortSignal.abort(reason) };
  await assert.rejects(reader.balance(recipient, holding.asset, aborted), reason);
  await assert.rejects(reader.delivery(requestOf(subject, delivered), aborted), reason);
}

/** The contract every `DeliveryReader` adapter passes. */
export function deliveryReaderContract(harness: DeliveryReaderHarness): readonly ContractCheck[] {
  return [
    { name: "reads an account's holding of an asset", run: async () => readsBalance(harness) },
    {
      name: "reads what a final transaction brought the recipient of the asset",
      run: async () => readsDelivery(harness),
    },
    {
      name: "reads a failed transaction as one that brought nothing",
      run: async () => readsFailure(harness),
    },
    {
      name: "reads no delivery for a transaction no block holds",
      run: async () => readsNothing(harness),
    },
    { name: "refuses an account of another chain", run: async () => refusesStranger(harness) },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => refusesAborted(harness),
    },
  ];
}
