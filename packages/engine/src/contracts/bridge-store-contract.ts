import assert from "node:assert/strict";
import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { BridgeDraft } from "../bridges/bridge-record.js";
import type { BridgeStore } from "../bridges/ports.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** A fresh, empty bridge store, and two intents it holds. */
export interface BridgeStoreSubject {
  readonly store: BridgeStore;
  readonly intentIds: readonly [Id<"int">, Id<"int">];
}

/** Makes a fresh {@link BridgeStoreSubject} for each check. */
export interface BridgeStoreHarness {
  create(): Promise<BridgeStoreSubject>;
}

function hashOf(byte: string): TxHash {
  const hash = `0x${byte.repeat(32)}`;
  assert.ok(isTxHash(hash));
  return hash;
}
const huge = 2n ** 64n + 1n;
const sentAtMs = 1_800_000_000_000;

function draftOf(intentId: Id<"int">, change: Partial<BridgeDraft> = {}): BridgeDraft {
  return {
    intentId,
    venue: "fake-cross",
    depositTx: hashOf("a1"),
    toChain: chainRefSchema.parse("fake:2"),
    recipient: accountRefSchema.parse("fake:2:0x000000f3"),
    sent: { asset: assetRefSchema.parse("fake:1/erc20:0x00000005"), base: huge },
    minOut: { asset: assetRefSchema.parse("fake:2/erc20:0x00000006"), base: huge - 1n },
    deliveredAsCoin: assetRefSchema.parse("fake:2/slip44:60"),
    valueUsdMicros: huge,
    statusUrl: "https://bridge.test/deposit",
    sentAtMs,
    ...change,
  };
}

async function opensOnce(subject: BridgeStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const draft = draftOf(intentIds[0]);
  const opened = await store.open(draft, live());
  assert.deepEqual(opened, { ...draft, state: "in_transit", version: 0 });
  const again = await store.open(draftOf(intentIds[0], { depositTx: hashOf("b2") }), live());
  assert.deepEqual(again, opened);
  assert.deepEqual(await store.get(intentIds[0], live()), opened);
  assert.equal(await store.get(intentIds[1], live()), undefined);
}

async function movesUnderVersion(subject: BridgeStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const intentId = intentIds[0];
  await store.open(draftOf(intentId), live());
  const late = await store.move(
    { intentId, expectedVersion: 0, atMs: sentAtMs + 1, to: "late" },
    live(),
  );
  assert.ok(late.ok);
  assert.equal(late.value.state, "late");
  assert.equal(late.value.lateAtMs, sentAtMs + 1);
  assert.equal(late.value.version, 1);
  const stale = { intentId, expectedVersion: 0, atMs: sentAtMs + 2, to: "late" } as const;
  assert.deepEqual(await store.move(stale, live()), { ok: false, error: "stale" });
  const received = { asset: assetRefSchema.parse("fake:2/slip44:60"), base: huge };
  const fill = { fillTx: hashOf("c3"), received };
  const delivered = await store.move(
    { intentId, expectedVersion: 1, atMs: sentAtMs + 3, to: "delivered", ...fill },
    live(),
  );
  assert.ok(delivered.ok);
  assert.deepEqual(delivered.value, {
    ...late.value,
    state: "delivered",
    ...fill,
    settledAtMs: sentAtMs + 3,
    checkedAtMs: sentAtMs + 3,
    version: 2,
  });
  const after = { intentId, expectedVersion: 2, atMs: sentAtMs + 4 };
  const refund = { refundTx: hashOf("d4"), received };
  assert.deepEqual(await store.move({ ...after, to: "refunded", ...refund }, live()), {
    ok: false,
    error: "stale",
  });
  assert.deepEqual(await store.move({ ...after, to: "late" }, live()), {
    ok: false,
    error: "stale",
  });
  assert.deepEqual(await store.get(intentId, live()), delivered.value);
}

async function refundsInTransit(subject: BridgeStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const intentId = intentIds[1];
  await store.open(draftOf(intentId), live());
  const received = { asset: assetRefSchema.parse("fake:1/erc20:0x00000005"), base: 7n };
  const refunded = await store.move(
    {
      intentId,
      expectedVersion: 0,
      atMs: sentAtMs + 9,
      to: "refunded",
      refundTx: hashOf("e5"),
      received,
    },
    live(),
  );
  assert.ok(refunded.ok);
  assert.equal(refunded.value.state, "refunded");
  assert.equal(refunded.value.refundTx, hashOf("e5"));
  assert.deepEqual(refunded.value.received, received);
  assert.equal(refunded.value.lateAtMs, undefined);
  const none = { intentId: intentIds[0], expectedVersion: 0, atMs: 1, to: "late" } as const;
  assert.deepEqual(await store.move(none, live()), { ok: false, error: "stale" });
}

async function listsByState(subject: BridgeStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const [first, second] = intentIds;
  await store.open(draftOf(first, { sentAtMs: sentAtMs + 10 }), live());
  await store.open(draftOf(second, { sentAtMs }), live());
  const open = await store.list({ states: ["in_transit", "late"], limit: 10 }, live());
  assert.deepEqual(
    open.map((bridge) => bridge.intentId),
    [second, first],
  );
  assert.ok(
    (await store.move({ intentId: second, expectedVersion: 0, atMs: 1, to: "late" }, live())).ok,
  );
  const late = await store.list({ states: ["late"], limit: 10 }, live());
  assert.deepEqual(
    late.map((bridge) => bridge.intentId),
    [second],
  );
  assert.equal((await store.list({ states: ["in_transit", "late"], limit: 1 }, live())).length, 1);
  const cursor = { sentAtMs, intentId: second };
  const next = await store.list(
    { states: ["in_transit", "late"], limit: 10, after: cursor },
    live(),
  );
  assert.deepEqual(
    next.map((bridge) => bridge.intentId),
    [first],
  );
  const last = { sentAtMs: sentAtMs + 10, intentId: first };
  assert.deepEqual(
    await store.list({ states: ["in_transit", "late"], limit: 10, after: last }, live()),
    [],
  );
}

// Settles the bridge of the intent, under version 0, with the transaction as its fill or refund.
async function settle(
  store: BridgeStore,
  intentId: Id<"int">,
  settled: { readonly to: "delivered" | "refunded"; readonly tx: TxHash },
) {
  const received = { asset: assetRefSchema.parse("fake:2/erc20:0x00000006"), base: 1n };
  const base = { intentId, expectedVersion: 0, atMs: sentAtMs + 5, received };
  return store.move(
    settled.to === "delivered"
      ? { ...base, to: "delivered", fillTx: settled.tx }
      : { ...base, to: "refunded", refundTx: settled.tx },
    live(),
  );
}

async function settlesOncePerTransaction(subject: BridgeStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const [first, second] = intentIds;
  await store.open(draftOf(first), live());
  await store.open(draftOf(second, { depositTx: hashOf("b2") }), live());
  const fill = hashOf("c3");
  assert.ok((await settle(store, first, { to: "delivered", tx: fill })).ok);
  assert.deepEqual(await settle(store, second, { to: "delivered", tx: fill }), {
    ok: false,
    error: "taken",
  });
  assert.equal((await store.settledBy(fill, live()))?.intentId, first);
  assert.equal(await store.settledBy(hashOf("f6"), live()), undefined);
  assert.equal((await store.get(second, live()))?.state, "in_transit");
}

async function refundsOncePerTransaction(subject: BridgeStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const [first, second] = intentIds;
  await store.open(draftOf(first), live());
  await store.open(
    draftOf(second, { depositTx: hashOf("b2"), toChain: chainRefSchema.parse("fake:3") }),
    live(),
  );
  const refund = hashOf("e5");
  assert.ok((await settle(store, first, { to: "refunded", tx: refund })).ok);
  assert.deepEqual(await settle(store, second, { to: "refunded", tx: refund }), {
    ok: false,
    error: "taken",
  });
  assert.equal((await store.settledBy(refund, live()))?.intentId, first);
}

async function refusesUnknownIntent(subject: BridgeStoreSubject): Promise<void> {
  const stranger = draftOf(fixtureId("int", 99));
  await assert.rejects(subject.store.open(stranger, live()), { code: "store.constraint" });
  assert.equal(await subject.store.get(stranger.intentId, live()), undefined);
}

async function refusesAborted(subject: BridgeStoreSubject): Promise<void> {
  const { store, intentIds } = subject;
  const draft = draftOf(intentIds[0]);
  await assertRefusesAborted(async (options) => store.open(draft, options));
  await assertRefusesAborted(async (options) => store.get(draft.intentId, options));
  await assertRefusesAborted(async (options) =>
    store.list({ states: ["in_transit"], limit: 1 }, options),
  );
  await assertRefusesAborted(async (options) => store.settledBy(hashOf("c3"), options));
  assert.equal(await store.get(draft.intentId, live()), undefined);
}

/** The contract every `BridgeStore` adapter passes. */
export function bridgeStoreContract(harness: BridgeStoreHarness): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn("opens a bridge once, with amounts past 64 bits", create, opensOnce),
    checkOn(
      "moves a bridge only under its version and from a state that takes it",
      create,
      movesUnderVersion,
    ),
    checkOn(
      "refunds a bridge in transit, and moves no bridge an intent lacks",
      create,
      refundsInTransit,
    ),
    checkOn(
      "lists bridges by state, the oldest deposit first, up to the limit, after a cursor",
      create,
      listsByState,
    ),
    checkOn(
      "settles at most one bridge with one fill to a chain",
      create,
      settlesOncePerTransaction,
    ),
    checkOn("settles at most one bridge with one refund", create, refundsOncePerTransaction),
    checkOn("refuses a bridge of an intent it does not hold", create, refusesUnknownIntent),
    checkOn("rejects with the signal's reason once the signal aborts", create, refusesAborted),
  ];
}
