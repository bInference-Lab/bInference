import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AliveStore } from "../downtime/ports.js";

/** Makes a fresh alive store, with no mark, for each check. */
export interface AliveStoreHarness {
  create(): Promise<AliveStore>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

async function startsEmpty(store: AliveStore): Promise<void> {
  assert.equal(await store.lastAlive(live()), undefined);
}

async function keepsTheLastMark(store: AliveStore): Promise<void> {
  await store.markAlive(1_000, live());
  await store.markAlive(61_000, live());
  assert.equal(await store.lastAlive(live()), 61_000);
}

// A wall clock set back writes an earlier mark, which counts from then on.
async function keepsAnEarlierMark(store: AliveStore): Promise<void> {
  await store.markAlive(61_000, live());
  await store.markAlive(5_000, live());
  assert.equal(await store.lastAlive(live()), 5_000);
}

async function refusesAborted(store: AliveStore): Promise<void> {
  const reason = new Error("stopped by the caller");
  await assert.rejects(store.markAlive(1_000, { signal: AbortSignal.abort(reason) }), reason);
  await assert.rejects(store.lastAlive({ signal: AbortSignal.abort(reason) }), reason);
  assert.equal(await store.lastAlive(live()), undefined);
}

/** The contract every `AliveStore` adapter passes. */
export function aliveStoreContract(harness: AliveStoreHarness): readonly ContractCheck[] {
  const on =
    (run: (store: AliveStore) => Promise<void>): (() => Promise<void>) =>
    async () =>
      run(await harness.create());
  return [
    { name: "has no mark before the first", run: on(startsEmpty) },
    { name: "answers the last mark it kept", run: on(keepsTheLastMark) },
    { name: "keeps a mark earlier than the one before", run: on(keepsAnEarlierMark) },
    { name: "refuses every call on an aborted signal and keeps nothing", run: on(refusesAborted) },
  ];
}
