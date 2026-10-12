import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AgentDraft } from "../agents/agent-record.js";
import type { AgentStore } from "../ports.js";
import { checkOn, fixtureId, live } from "./store-fixtures.js";

async function setsNotifications(store: AgentStore, draft: AgentDraft): Promise<void> {
  await store.create(draft, live());
  const agentId = draft.id;
  const notifications = { muted: ["fill", "lowGas"], dailySummaryTime: "08:30" };
  const change = { agentId, notifications, atMs: 4_000, expectedVersion: 0 };
  const set = await store.setNotifications(change, live());
  const { id, name, mode, locale, models, atMs } = draft;
  const fields = { id, name, mode, locale, models, notifications };
  const record = { ...fields, createdAtMs: atMs, changedAtMs: 4_000, version: 1 };
  assert.deepEqual(set, { ok: true, value: record });
  assert.deepEqual(await store.setNotifications(change, live()), { ok: false, error: "stale" });
  const unknown = { ...change, agentId: fixtureId("agt", 9) };
  const missing = await store.setNotifications(unknown, live());
  assert.deepEqual(missing, { ok: false, error: "not_found" });
  assert.deepEqual((await store.get(agentId, live()))?.agent, record);
}

async function setsModels(store: AgentStore, draft: AgentDraft): Promise<void> {
  await store.create(draft, live());
  const agentId = draft.id;
  const models = { main: "openai/gpt-5.1-mini" };
  const change = { agentId, models, atMs: 4_500, expectedVersion: 0 };
  const set = await store.setModels(change, live());
  assert.ok(set.ok);
  assert.deepEqual(set.value.models, models);
  assert.equal(set.value.version, 1);
  assert.deepEqual(await store.setModels(change, live()), { ok: false, error: "stale" });
  const unknown = { ...change, agentId: fixtureId("agt", 9) };
  assert.deepEqual(await store.setModels(unknown, live()), { ok: false, error: "not_found" });
  assert.deepEqual((await store.get(agentId, live()))?.agent, set.value);
}

/**
 * The checks of the agent row's documents an `AgentStore` keeps as given: the notice settings
 * (decision 0185) and the models the owner picked (decision 0204), each under the agent row's
 * version the changer read, on a store that holds no agent yet.
 */
export function agentRowChecks(
  create: () => Promise<AgentStore>,
  draft: AgentDraft,
): readonly ContractCheck[] {
  return [
    checkOn(
      "sets the notice settings under the agent row's version the changer read",
      create,
      async (store) => setsNotifications(store, draft),
    ),
    checkOn("sets the picked models under the agent row's version read", create, async (store) =>
      setsModels(store, draft),
    ),
  ];
}
