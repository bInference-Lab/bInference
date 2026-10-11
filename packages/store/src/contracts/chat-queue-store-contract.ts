import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { QueueDraft } from "../chats/queued-message.js";
import type { ChatQueueStore, WriterFence } from "../ports.js";
import { fencedCheck, go, nthId, okValue, rejectsAborted } from "./agent-fixtures.js";

/** A fresh chat queue on an empty agent database, with that database's writer fence. */
export interface ChatQueueStoreSubject {
  readonly store: ChatQueueStore;
  readonly fence: WriterFence;
}

/** Makes a fresh subject for each check. */
export interface ChatQueueStoreHarness {
  create(): Promise<ChatQueueStoreSubject>;
}

function nthMessage(n: number, receivedAtMs = n * 10, session = 1): QueueDraft {
  return {
    message: nthId("msg", n),
    agentId: nthId("agt", 1),
    sessionId: nthId("ses", session),
    kind: "inbox/message",
    payload: { text: `message ${String(n)}`, surface: "telegram" },
    receivedAtMs,
  };
}

const sessionOne = { sessionId: nthId("ses", 1), limit: 20 };

async function addsOnce({ store }: ChatQueueStoreSubject, fence: number): Promise<void> {
  assert.deepEqual(await store.add({ ...nthMessage(2), fence }, go()), {
    ok: true,
    value: nthMessage(2),
  });
  await store.add({ ...nthMessage(1, 30), fence }, go());
  await store.add({ ...nthMessage(3, 5, 2), fence }, go());
  const again = { ...nthMessage(2), payload: "pushed again", fence };
  assert.deepEqual(await store.add(again, go()), { ok: false, error: "exists" });
  const waiting = await store.waiting(sessionOne, go());
  assert.deepEqual(waiting, [nthMessage(2), nthMessage(1, 30)]);
  assert.deepEqual(await store.waiting({ ...sessionOne, limit: 1 }, go()), [nthMessage(2)]);
}

async function listsEverySession({ store }: ChatQueueStoreSubject, fence: number): Promise<void> {
  await store.add({ ...nthMessage(1, 30), fence }, go());
  await store.add({ ...nthMessage(2, 20, 2), fence }, go());
  await store.add({ ...nthMessage(3, 10, 3), fence }, go());
  await store.take({ messages: [nthId("msg", 3)], turn: nthId("trn", 1), fence }, go());
  assert.deepEqual(await store.waiting({ limit: 1_000 }, go()), [
    nthMessage(2, 20, 2),
    nthMessage(1, 30),
  ]);
  assert.deepEqual(await store.waiting({ limit: 1 }, go()), [nthMessage(2, 20, 2)]);
}

async function takesAllOrNone({ store }: ChatQueueStoreSubject, fence: number): Promise<void> {
  await store.add({ ...nthMessage(1), fence }, go());
  await store.add({ ...nthMessage(2), fence }, go());
  await store.add({ ...nthMessage(3), fence }, go());
  const turn = nthId("trn", 1);
  const unknown = { messages: [nthId("msg", 1), nthId("msg", 9)], turn, fence };
  assert.deepEqual(await store.take(unknown, go()), { ok: false, error: "not_waiting" });
  const taken = okValue(await store.take({ messages: [nthId("msg", 1)], turn, fence }, go()));
  assert.deepEqual(taken, [{ ...nthMessage(1), turnId: turn }]);
  const twice = { messages: [nthId("msg", 2), nthId("msg", 1)], turn: nthId("trn", 2), fence };
  assert.deepEqual(await store.take(twice, go()), { ok: false, error: "not_waiting" });
  const waiting = await store.waiting(sessionOne, go());
  assert.deepEqual(waiting, [nthMessage(2), nthMessage(3)]);
}

async function dropsWithReason({ store }: ChatQueueStoreSubject, fence: number): Promise<void> {
  await store.add({ ...nthMessage(1), fence }, go());
  await store.add({ ...nthMessage(2), fence }, go());
  const drop = { message: nthId("msg", 1), atMs: 50, reason: "budget", fence };
  assert.deepEqual(await store.drop(drop, go()), {
    ok: true,
    value: { ...nthMessage(1), droppedAtMs: 50, dropReason: "budget" },
  });
  assert.deepEqual(await store.drop(drop, go()), { ok: false, error: "not_waiting" });
  const take = { messages: [nthId("msg", 1)], turn: nthId("trn", 1), fence };
  assert.deepEqual(await store.take(take, go()), { ok: false, error: "not_waiting" });
  const unknown = { ...drop, message: nthId("msg", 9) };
  assert.deepEqual(await store.drop(unknown, go()), { ok: false, error: "not_found" });
  await store.take({ messages: [nthId("msg", 2)], turn: nthId("trn", 1), fence }, go());
  const taken = { ...drop, message: nthId("msg", 2) };
  assert.deepEqual(await store.drop(taken, go()), { ok: false, error: "not_waiting" });
  assert.deepEqual(await store.waiting(sessionOne, go()), []);
}

async function refusesStaleFence(subject: ChatQueueStoreSubject, old: number): Promise<void> {
  const { store } = subject;
  await store.add({ ...nthMessage(1), fence: old }, go());
  await subject.fence.raise(go());
  const fenced = { ok: false, error: "fenced" };
  assert.deepEqual(await store.add({ ...nthMessage(2), fence: old }, go()), fenced);
  const take = { messages: [nthId("msg", 1)], turn: nthId("trn", 1), fence: old };
  assert.deepEqual(await store.take(take, go()), fenced);
  const drop = { message: nthId("msg", 1), atMs: 1, reason: "stop", fence: old };
  assert.deepEqual(await store.drop(drop, go()), fenced);
  assert.deepEqual(await store.waiting(sessionOne, go()), [nthMessage(1)]);
}

async function refusesAborted({ store }: ChatQueueStoreSubject, fence: number): Promise<void> {
  await rejectsAborted(async (options) => store.add({ ...nthMessage(1), fence }, options));
  await rejectsAborted(async (options) => store.waiting(sessionOne, options));
  const take = { messages: [nthId("msg", 1)], turn: nthId("trn", 1), fence };
  await rejectsAborted(async (options) => store.take(take, options));
  const drop = { message: nthId("msg", 1), atMs: 1, reason: "stop", fence };
  await rejectsAborted(async (options) => store.drop(drop, options));
  assert.deepEqual(await store.waiting(sessionOne, go()), []);
}

/** The contract every `ChatQueueStore` adapter passes. */
export function chatQueueStoreContract(harness: ChatQueueStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<ChatQueueStoreSubject> => harness.create();
  return [
    fencedCheck("adds each message once and lists those that wait, oldest first", create, addsOnce),
    fencedCheck(
      "lists the waiting messages of every session, oldest first",
      create,
      listsEverySession,
    ),
    fencedCheck("gives waiting messages to a turn, all or none", create, takesAllOrNone),
    fencedCheck("drops a waiting message with its reason, once", create, dropsWithReason),
    fencedCheck("refuses every write made with a fence raised since", create, refusesStaleFence),
    fencedCheck(
      "refuses every call on an aborted signal and writes nothing",
      create,
      refusesAborted,
    ),
  ];
}
