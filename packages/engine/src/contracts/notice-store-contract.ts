import assert from "node:assert/strict";
import { assetRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { NoticeRecord } from "../notices/notice-record.js";
import type { NoticeStore } from "../ports.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

/** A fresh, empty notice store, and an agent its store holds. */
export interface NoticeStoreSubject {
  readonly notices: NoticeStore;
  readonly agent: Id<"agt">;
}

/** Makes a fresh subject for each check. */
export interface NoticeStoreHarness {
  create(): Promise<NoticeStoreSubject>;
}

// 2^64 + 1 does not fit a SQLite integer: an amount must round-trip as decimal text.
const beyond64Bits = 2n ** 64n + 1n;
const coin = assetRefSchema.parse("fake:1/slip44:1");

function lowGas(n: number, agent: Id<"agt">): NoticeRecord {
  return {
    id: fixtureId("ntc", n),
    atMs: 1_000 + n,
    notice: {
      key: "notice.lowGas",
      agent,
      intent: fixtureId("int", n),
      values: { wallet: "Main" },
      times: { when: 9_000 },
      amounts: { balance: { asset: coin, base: beyond64Bits } },
    },
    kind: "lowGas",
    level: "warning",
    delivered: { telegram: "queued" },
  };
}

// A notice about the whole install that no surface delivers.
function locked(n: number): NoticeRecord {
  return {
    id: fixtureId("ntc", n),
    atMs: 1_000 + n,
    notice: { key: "notice.locked", values: {} },
    kind: "locked",
    level: "critical",
    delivered: {},
  };
}

async function recordAll(subject: NoticeStoreSubject, numbers: readonly number[]): Promise<void> {
  await inOrder(numbers, async (n) => subject.notices.record(lowGas(n, subject.agent), live()));
}

async function storesAndLists(subject: NoticeStoreSubject): Promise<void> {
  const { notices, agent } = subject;
  await notices.record(lowGas(1, agent), live());
  await notices.record(locked(2), live());
  assert.deepEqual(await notices.list({ limit: 10 }, live()), [lowGas(1, agent), locked(2)]);
  const queued = await notices.queued({ surface: "telegram", limit: 10 }, live());
  assert.deepEqual(queued, [
    {
      id: 1,
      surface: "telegram",
      state: "queued",
      attempts: 0,
      nextAtMs: 1_001,
      record: lowGas(1, agent),
    },
  ]);
}

async function pagesAfterCursor(subject: NoticeStoreSubject): Promise<void> {
  await recordAll(subject, [3, 1, 2]);
  const page = await subject.notices.list({ after: fixtureId("ntc", 1), limit: 1 }, live());
  assert.deepEqual(
    page.map((record) => record.id),
    [fixtureId("ntc", 2)],
  );
  const queued = await subject.notices.queued({ surface: "telegram", limit: 2 }, live());
  assert.deepEqual(
    queued.map((delivery) => delivery.record.id),
    [fixtureId("ntc", 3), fixtureId("ntc", 1)],
  );
}

async function firstQueued(subject: NoticeStoreSubject): Promise<number> {
  const [delivery] = await subject.notices.queued({ surface: "telegram", limit: 1 }, live());
  assert.ok(delivery !== undefined);
  return delivery.id;
}

async function movesFromItsState(subject: NoticeStoreSubject): Promise<void> {
  const { notices } = subject;
  await recordAll(subject, [1]);
  const id = await firstQueued(subject);
  const claimed = await notices.move({ id, from: "queued", to: "unknown_after_send" }, live());
  assert.ok(claimed.ok);
  assert.equal(claimed.value.attempts, 1);
  assert.equal(claimed.value.record.delivered.telegram, "unknown_after_send");
  const again = await notices.move({ id, from: "queued", to: "unknown_after_send" }, live());
  assert.deepEqual(again, { ok: false, error: "moved" });
  const sent = await notices.move({ id, from: "unknown_after_send", to: "sent", atMs: 5 }, live());
  assert.equal(sent.ok && sent.value.state, "sent");
  const [record] = await notices.list({ limit: 1 }, live());
  assert.deepEqual(record?.delivered, { telegram: "sent" });
  assert.deepEqual(await notices.queued({ surface: "telegram", limit: 10 }, live()), []);
  const unknown = await notices.move({ id: id + 100, from: "queued", to: "failed" }, live());
  assert.deepEqual(unknown, { ok: false, error: "not_found" });
}

async function queuesRefusedAgain(subject: NoticeStoreSubject): Promise<void> {
  const { notices } = subject;
  await recordAll(subject, [1, 2]);
  const id = await firstQueued(subject);
  await notices.move({ id, from: "queued", to: "unknown_after_send" }, live());
  await notices.move({ id, from: "unknown_after_send", to: "queued", nextAtMs: 7_000 }, live());
  const [delivery, next] = await notices.queued({ surface: "telegram", limit: 10 }, live());
  assert.deepEqual(
    { id: delivery?.id, attempts: delivery?.attempts, nextAtMs: delivery?.nextAtMs },
    { id, attempts: 1, nextAtMs: 7_000 },
  );
  assert.equal(delivery?.record.delivered.telegram, "queued");
  assert.equal(next?.record.id, fixtureId("ntc", 2));
}

async function failsForGood(subject: NoticeStoreSubject): Promise<void> {
  const { notices } = subject;
  await recordAll(subject, [1]);
  const id = await firstQueued(subject);
  const failed = await notices.move({ id, from: "queued", to: "failed" }, live());
  assert.equal(failed.ok && failed.value.record.delivered.telegram, "failed");
  assert.deepEqual(await notices.queued({ surface: "telegram", limit: 10 }, live()), []);
}

async function refusesUnknownAgent(subject: NoticeStoreSubject): Promise<void> {
  const stranger = lowGas(1, fixtureId("agt", 999));
  await assert.rejects(subject.notices.record(stranger, live()), { code: "store.constraint" });
  assert.deepEqual(await subject.notices.list({ limit: 10 }, live()), []);
  assert.deepEqual(await subject.notices.queued({ surface: "telegram", limit: 10 }, live()), []);
}

async function prunesOld(subject: NoticeStoreSubject): Promise<void> {
  const { notices } = subject;
  await recordAll(subject, [1, 2, 3]);
  assert.equal(await notices.prune(1_003, live()), 2);
  const kept = await notices.list({ limit: 10 }, live());
  assert.deepEqual(
    kept.map((record) => record.id),
    [fixtureId("ntc", 3)],
  );
  const queued = await notices.queued({ surface: "telegram", limit: 10 }, live());
  assert.deepEqual(
    queued.map((delivery) => delivery.record.id),
    [fixtureId("ntc", 3)],
  );
}

async function refusesAborted(subject: NoticeStoreSubject): Promise<void> {
  const { notices, agent } = subject;
  await assertRefusesAborted(async (options) => notices.record(lowGas(1, agent), options));
  await assertRefusesAborted(async (options) => notices.list({ limit: 1 }, options));
  await assertRefusesAborted(async (options) =>
    notices.queued({ surface: "telegram", limit: 1 }, options),
  );
  await assertRefusesAborted(async (options) =>
    notices.move({ id: 1, from: "queued", to: "failed" }, options),
  );
  await assertRefusesAborted(async (options) => notices.prune(1, options));
  assert.deepEqual(await notices.list({ limit: 10 }, live()), []);
}

/** The contract every `NoticeStore` adapter passes. */
export function noticeStoreContract(harness: NoticeStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<NoticeStoreSubject> => harness.create();
  return [
    checkOn(
      "stores a notice with a queued delivery for each surface it names",
      create,
      storesAndLists,
    ),
    checkOn(
      "lists notices after a cursor in id order and deliveries in the order recorded",
      create,
      pagesAfterCursor,
    ),
    checkOn(
      "moves a delivery only from the state it was read in, the notice with it",
      create,
      movesFromItsState,
    ),
    checkOn("queues a refused delivery again at its next time", create, queuesRefusedAgain),
    checkOn("fails a delivery the surface refuses for good", create, failsForGood),
    checkOn("refuses a notice of an agent the store does not hold", create, refusesUnknownAgent),
    checkOn("prunes the notices recorded before a time with their deliveries", create, prunesOld),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
