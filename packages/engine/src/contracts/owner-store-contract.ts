import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { OwnerStore } from "../surfaces/ports.js";
import { fixtureId } from "./store-fixtures.js";

/** Makes a fresh owner store, with no owner, for each check. */
export interface OwnerStoreHarness {
  create(): Promise<OwnerStore>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const owner = { userId: 7_012_345_678, pairedAtMs: 1_000 };

async function startsEmpty(store: OwnerStore): Promise<void> {
  assert.equal(await store.get(live()), undefined);
}

async function bindsTheFirst(store: OwnerStore): Promise<void> {
  assert.equal(await store.bind(owner, live()), undefined);
  assert.deepEqual(await store.get(live()), owner);
}

async function replacesTheOwner(store: OwnerStore): Promise<void> {
  const next = { userId: 7_100_000_042, pairedAtMs: 2_000 };
  await store.bind(owner, live());
  assert.deepEqual(await store.bind(next, live()), owner);
  assert.deepEqual(await store.get(live()), next);
  const again = { ...next, pairedAtMs: 3_000 };
  assert.deepEqual(await store.bind(again, live()), next);
  assert.deepEqual(await store.get(live()), again);
}

async function keepsThePickedAgent(store: OwnerStore): Promise<void> {
  const agentId = fixtureId("agt", 1);
  assert.equal(await store.useAgent(agentId, live()), false);
  assert.equal(await store.get(live()), undefined);
  await store.bind(owner, live());
  assert.equal(await store.useAgent(agentId, live()), true);
  assert.deepEqual(await store.get(live()), { ...owner, agentId });
  const next = { userId: 7_100_000_042, pairedAtMs: 2_000 };
  assert.deepEqual(await store.bind(next, live()), { ...owner, agentId });
  assert.deepEqual(await store.get(live()), next);
}

async function refusesAborted(store: OwnerStore): Promise<void> {
  const reason = new Error("stopped by the caller");
  await assert.rejects(store.bind(owner, { signal: AbortSignal.abort(reason) }), reason);
  await assert.rejects(store.get({ signal: AbortSignal.abort(reason) }), reason);
  const agent = fixtureId("agt", 1);
  await assert.rejects(store.useAgent(agent, { signal: AbortSignal.abort(reason) }), reason);
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
    { name: "binds the first owner and answers no earlier one", run: on(bindsTheFirst) },
    { name: "replaces the owner and answers the one it replaced", run: on(replacesTheOwner) },
    { name: "keeps the agent the chat picked until a new pairing", run: on(keepsThePickedAgent) },
    { name: "refuses every call on an aborted signal and binds nobody", run: on(refusesAborted) },
  ];
}
