import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { IdempotencyEntry, IdempotencyMark } from "../ingress/idempotency-entry.js";
import type { IdempotencyStore } from "../ingress/ports.js";
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

function mark(overrides: Partial<IdempotencyMark> = {}): IdempotencyMark {
  const { result: _result, ...started } = entry(overrides);
  return started;
}

const otherArgs = { argsHash: fixtureHash("args two") };

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
  const other = entry({ ...otherArgs, result: "other" });
  assert.deepEqual(await store.recall(other, live()), { kind: "reused" });
  assert.deepEqual(await store.remember(other, live()), { kind: "reused" });
  assert.deepEqual(await store.recall(entry(), live()), { kind: "repeat", result: entry().result });
}

async function startsOnce(store: IdempotencyStore): Promise<void> {
  assert.deepEqual(await store.start(mark(), live()), { kind: "started" });
  assert.deepEqual(await store.start(mark({ atMs: 2_000 }), live()), { kind: "unfinished" });
  assert.deepEqual(await store.start(mark(otherArgs), live()), { kind: "reused" });
}

async function finishesTheStartedKey(store: IdempotencyStore): Promise<void> {
  await store.start(mark(), live());
  await store.finish(entry({ atMs: 3_000 }), live());
  const repeat = { kind: "repeat", result: entry().result };
  assert.deepEqual(await store.start(mark({ atMs: 4_000 }), live()), repeat);
  assert.deepEqual(await store.start(mark(otherArgs), live()), { kind: "reused" });
  await store.finish(entry({ atMs: 5_000 }), live());
  await assert.rejects(store.finish(entry({ result: "another" }), live()), {
    code: "store.constraint",
  });
  assert.deepEqual(await store.start(mark(), live()), repeat);
}

async function refusesAResultOfOtherArgs(store: IdempotencyStore): Promise<void> {
  await store.start(mark(), live());
  await assert.rejects(store.finish(entry(otherArgs), live()), { code: "store.constraint" });
  assert.deepEqual(await store.start(mark(), live()), { kind: "unfinished" });
}

// A mark the prune took while its write ran (a machine asleep past a day) is written again by its
// result, so the key never reads free after the write landed.
async function writesAResultWhoseMarkIsGone(store: IdempotencyStore): Promise<void> {
  await store.finish(entry(), live());
  assert.deepEqual(await store.start(mark(), live()), { kind: "repeat", result: entry().result });
  assert.deepEqual(await store.start(mark(otherArgs), live()), { kind: "reused" });
}

async function forgetsOnlyAStartedKey(store: IdempotencyStore): Promise<void> {
  await store.forget(mark(), live());
  await store.start(mark(), live());
  await store.forget(mark(otherArgs), live());
  assert.deepEqual(await store.start(mark(), live()), { kind: "unfinished" });
  await store.forget(mark(), live());
  assert.deepEqual(await store.start(mark(), live()), { kind: "started" });
  await store.finish(entry(), live());
  await store.forget(mark(), live());
  assert.deepEqual(await store.start(mark(), live()), { kind: "repeat", result: entry().result });
}

async function keepsKeysApart(store: IdempotencyStore): Promise<void> {
  await store.start(mark(), live());
  await store.finish(entry(), live());
  const others = [
    mark({ credential: fixtureId("dev", 2) }),
    mark({ op: "order/create" }),
    mark({ key: "another-key" }),
  ];
  const started = await Promise.all(others.map(async (other) => store.start(other, live())));
  assert.deepEqual(started, [{ kind: "started" }, { kind: "started" }, { kind: "started" }]);
}

async function prunesOld(store: IdempotencyStore): Promise<void> {
  await store.start(mark({ key: "old", atMs: 1_000 }), live());
  await store.finish(entry({ key: "old", atMs: 1_000 }), live());
  await store.start(mark({ key: "old started", atMs: 1_500 }), live());
  await store.start(mark({ key: "edge", atMs: 2_000 }), live());
  await store.start(mark({ key: "new", atMs: 2_500 }), live());
  await store.finish(entry({ key: "new", atMs: 3_000 }), live());
  assert.equal(await store.prune({ beforeMs: 2_000, running: [] }, live()), 2);
  assert.deepEqual(await store.start(mark({ key: "old" }), live()), { kind: "started" });
  assert.deepEqual(await store.start(mark({ key: "old started" }), live()), { kind: "started" });
  assert.equal((await store.start(mark({ key: "edge" }), live())).kind, "unfinished");
  assert.equal((await store.start(mark({ key: "new" }), live())).kind, "repeat");
}

// A mark the running engine start still runs outlasts its 24 hours, so the key never reads free
// while its write runs; another key's old mark goes.
async function keepsARunningMark(store: IdempotencyStore): Promise<void> {
  await store.start(mark({ key: "running", atMs: 1_000 }), live());
  await store.start(mark({ key: "left", atMs: 1_000 }), live());
  const running = [mark({ key: "running" })];
  assert.equal(await store.prune({ beforeMs: 2_000, running }, live()), 1);
  assert.equal((await store.start(mark({ key: "running" }), live())).kind, "unfinished");
  assert.equal((await store.start(mark({ key: "left" }), live())).kind, "started");
}

async function refusesAborted(store: IdempotencyStore): Promise<void> {
  await assertRefusesAborted(async (options) => store.start(mark(), options));
  await assertRefusesAborted(async (options) =>
    store.prune({ beforeMs: 5_000, running: [] }, options),
  );
  assert.deepEqual(await store.start(mark(), live()), { kind: "started" });
  await assertRefusesAborted(async (options) => store.forget(mark(), options));
  await assertRefusesAborted(async (options) => store.finish(entry(), options));
  assert.deepEqual(await store.start(mark(), live()), { kind: "unfinished" });
}

/** The contract every `IdempotencyStore` adapter passes. */
export function idempotencyStoreContract(
  harness: IdempotencyStoreHarness,
): readonly ContractCheck[] {
  const create = async (): Promise<IdempotencyStore> => harness.create();
  return [
    checkOn("remembers a result once and repeats it for the same args", create, remembersOnce),
    checkOn("answers reused for other args and keeps the first result", create, refusesOtherArgs),
    checkOn("starts a key once and answers unfinished or reused after", create, startsOnce),
    checkOn("fills a started key once and repeats its result", create, finishesTheStartedKey),
    checkOn("refuses a result of other args than its mark's", create, refusesAResultOfOtherArgs),
    checkOn(
      "writes a result whose mark is gone, so its key repeats it",
      create,
      writesAResultWhoseMarkIsGone,
    ),
    checkOn("forgets only a started key of the same args", create, forgetsOnlyAStartedKey),
    checkOn("keeps the keys of other credentials and operations apart", create, keepsKeysApart),
    checkOn(
      "prunes the keys started or stored before a time and keeps the rest",
      create,
      prunesOld,
    ),
    checkOn("keeps a mark its engine start still runs past its time", create, keepsARunningMark),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
