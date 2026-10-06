import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { OwnerStore } from "../ports.js";

/** Makes a fresh owner store, with no owner, for each check. */
export interface OwnerStoreHarness {
  create(): Promise<OwnerStore>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const owner = { userId: 7_012_345_678, pairedAtMs: 1_000 };

async function startsEmpty(store: OwnerStore): Promise<void> {
  assert.equal(await store.get(live()), undefined);
}

async function keepsTheFirst(store: OwnerStore): Promise<void> {
  assert.deepEqual(await store.bind(owner, live()), { ok: true, value: owner });
  const other = { userId: 42, pairedAtMs: 2_000 };
  assert.deepEqual(await store.bind(other, live()), { ok: false, error: "bound" });
  assert.deepEqual(await store.bind(owner, live()), { ok: false, error: "bound" });
  assert.deepEqual(await store.get(live()), owner);
}

async function refusesAborted(store: OwnerStore): Promise<void> {
  const reason = new Error("stopped by the caller");
  await assert.rejects(store.bind(owner, { signal: AbortSignal.abort(reason) }), reason);
  await assert.rejects(store.get({ signal: AbortSignal.abort(reason) }), reason);
  assert.equal(await store.get(live()), undefined);
}

/** The contract every `OwnerStore` adapter passes. */
export function ownerStoreContract(harness: OwnerStoreHarness): readonly ContractCheck[] {
  const on =
    (run: (store: OwnerStore) => Promise<void>): (() => Promise<void>) =>
    async () =>
      run(await harness.create());
  return [
    { name: "has no owner before one is bound", run: on(startsEmpty) },
    { name: "keeps the first owner and refuses every later binding", run: on(keepsTheFirst) },
    { name: "refuses every call on an aborted signal and binds nobody", run: on(refusesAborted) },
  ];
}
