import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { IdempotencyEntry } from "../ingress/idempotency-entry.js";
import type { IdempotencyStore } from "../ports.js";
import { assertRefusesAborted, checkOn, fixtureHash, fixtureId, live } from "./store-fixtures.js";

/** Makes a fresh, empty idempotency store for each check. */
export interface IdempotencyStoreHarness {
  create(): Promise<IdempotencyStore>;
}

function entry(overrides: Partial<IdempotencyEntry> = {}): IdempotencyEntry {
  return {
    credential: fixtureId("tok", 1),
    op: "intent/propose",
    key: "0190f1c2-3a4b-7c5d-8e6f-000000000001",
    argsHash: fixtureHash("args one"),
    result: { intent: fixtureId("int", 1), state: "proposed" },
    atMs: 1_000,
    ...overrides,
  };
}

async function remembersOnce(store: IdempotencyStore): Promise<void> {
  assert.deepEqual(await store.recall(entry(), live()), { kind: "new" });
  assert.deepEqual(await store.remember(entry(), live()), { kind: "new" });
  const repeat = { kind: "repeat", result: entry().result };
  assert.deepEqual(await store.recall(entry(), live()), repeat);
  assert.deepEqual(await store.remember(entry({ result: "second", atMs: 2_000 }), live()), repeat);
  assert.deepEqual(await store.recall(entry(), live()), repeat);
}

async function refusesOtherArgs(store: IdempotencyStore): Promise<void> {
  await store.remember(entry(), live());
  const other = entry({ argsHash: fixtureHash("args two"), result: "other" });
  assert.deepEqual(await store.recall(other, live()), { kind: "reused" });
  assert.deepEqual(await store.remember(other, live()), { kind: "reused" });
  assert.deepEqual(await store.recall(entry(), live()), { kind: "repeat", result: entry().result });
}

async function keepsKeysApart(store: IdempotencyStore): Promise<void> {
  await store.remember(entry(), live());
  const others = [
    entry({ credential: fixtureId("dev", 2) }),
    entry({ op: "order/create" }),
    entry({ key: "another-key" }),
  ];
  const recalled = await Promise.all(others.map(async (other) => store.recall(other, live())));
  assert.deepEqual(recalled, [{ kind: "new" }, { kind: "new" }, { kind: "new" }]);
}

async function prunesOld(store: IdempotencyStore): Promise<void> {
  await store.remember(entry({ key: "old", atMs: 1_000 }), live());
  await store.remember(entry({ key: "edge", atMs: 2_000 }), live());
  await store.remember(entry({ key: "new", atMs: 3_000 }), live());
  assert.equal(await store.prune(2_000, live()), 1);
  assert.deepEqual(await store.recall(entry({ key: "old" }), live()), { kind: "new" });
  assert.equal((await store.recall(entry({ key: "edge" }), live())).kind, "repeat");
  assert.equal((await store.recall(entry({ key: "new" }), live())).kind, "repeat");
}

async function refusesAborted(store: IdempotencyStore): Promise<void> {
  await assertRefusesAborted(async (options) => store.remember(entry(), options));
  await assertRefusesAborted(async (options) => store.recall(entry(), options));
  await assertRefusesAborted(async (options) => store.prune(5_000, options));
  assert.deepEqual(await store.recall(entry(), live()), { kind: "new" });
}

/** The contract every `IdempotencyStore` adapter passes. */
export function idempotencyStoreContract(
  harness: IdempotencyStoreHarness,
): readonly ContractCheck[] {
  const create = async (): Promise<IdempotencyStore> => harness.create();
  return [
    checkOn("remembers a result once and repeats it for the same args", create, remembersOnce),
    checkOn("answers reused for other args and keeps the first result", create, refusesOtherArgs),
    checkOn("keeps the keys of other credentials and operations apart", create, keepsKeysApart),
    checkOn("prunes the results stored before a time and keeps the rest", create, prunesOld),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
