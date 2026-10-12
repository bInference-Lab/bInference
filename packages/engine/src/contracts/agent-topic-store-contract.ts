import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AgentTopicStore } from "../surfaces/ports.js";
import { fixtureId } from "./store-fixtures.js";

/** Makes a fresh topic store, with no topic, for each check. */
export interface AgentTopicStoreHarness {
  create(): Promise<AgentTopicStore>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const chatId = 7_012_345_678;
const agentId = fixtureId("agt", 1);
const topic = { agentId, chatId, threadId: 41, createdAtMs: 1_000 };

async function startsEmpty(store: AgentTopicStore): Promise<void> {
  assert.equal(await store.find({ agentId, chatId }, live()), undefined);
}

async function keepsOnePerAgentAndChat(store: AgentTopicStore): Promise<void> {
  const other = { ...topic, agentId: fixtureId("agt", 2), threadId: 42 };
  await store.keep(topic, live());
  await store.keep(other, live());
  assert.deepEqual(await store.find({ agentId, chatId }, live()), topic);
  const newer = { ...topic, threadId: 43, createdAtMs: 2_000 };
  await store.keep(newer, live());
  assert.deepEqual(await store.find({ agentId, chatId }, live()), newer);
  assert.deepEqual(await store.find({ agentId: other.agentId, chatId }, live()), other);
  assert.equal(await store.find({ agentId, chatId: 7_100_000_001 }, live()), undefined);
}

async function forgetsOnlyTheGoneTopic(store: AgentTopicStore): Promise<void> {
  await store.keep(topic, live());
  await store.forget({ agentId, chatId, threadId: 99 }, live());
  assert.deepEqual(await store.find({ agentId, chatId }, live()), topic);
  await store.forget({ agentId, chatId, threadId: topic.threadId }, live());
  assert.equal(await store.find({ agentId, chatId }, live()), undefined);
}

async function refusesAborted(store: AgentTopicStore): Promise<void> {
  const reason = new Error("stopped by the caller");
  const aborted = { signal: AbortSignal.abort(reason) };
  await assert.rejects(store.keep(topic, aborted), reason);
  await assert.rejects(store.find({ agentId, chatId }, aborted), reason);
  await assert.rejects(store.forget({ agentId, chatId, threadId: 41 }, aborted), reason);
  assert.equal(await store.find({ agentId, chatId }, live()), undefined);
}

/** The contract every `AgentTopicStore` adapter passes. */
export function agentTopicStoreContract(harness: AgentTopicStoreHarness): readonly ContractCheck[] {
  const on =
    (run: (store: AgentTopicStore) => Promise<void>): (() => Promise<void>) =>
    async () =>
      run(await harness.create());
  return [
    { name: "has no topic before one is kept", run: on(startsEmpty) },
    { name: "keeps one topic for each agent and chat", run: on(keepsOnePerAgentAndChat) },
    { name: "forgets a topic only while it is the gone one", run: on(forgetsOnlyTheGoneTopic) },
    { name: "refuses every call on an aborted signal and keeps nothing", run: on(refusesAborted) },
  ];
}
