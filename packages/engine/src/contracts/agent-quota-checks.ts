import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AgentDraft } from "../agents/agent-record.js";
import type { AgentStore } from "../ports.js";
import { checkOn, fixtureId, live } from "./store-fixtures.js";

type Drafts = (n: number) => AgentDraft;

const within = (quota: number) => ({ ...live(), quota });

async function refusesAnAgentPastItsQuota(store: AgentStore, draft: Drafts): Promise<void> {
  assert.ok((await store.create(draft(1), within(2))).ok);
  assert.ok((await store.create(draft(2), within(2))).ok);
  assert.deepEqual(await store.create(draft(3), within(2)), { ok: false, error: "quota" });
  assert.deepEqual(await store.create(draft(1), within(2)), { ok: false, error: "exists" });
  assert.deepEqual(await store.create({ ...draft(4), name: draft(2).name }, within(2)), {
    ok: false,
    error: "name_taken",
  });
  assert.deepEqual(
    (await store.list(live())).map(({ id }) => id),
    [draft(1).id, draft(2).id],
  );
  assert.ok((await store.create(draft(3), within(3))).ok);
  assert.ok((await store.create(draft(4), live())).ok);
}

async function takesOneOfTwoForTheLastRoom(store: AgentStore, draft: Drafts): Promise<void> {
  assert.ok((await store.create(draft(1), live())).ok);
  const both = await Promise.all([
    store.create(draft(2), within(2)),
    store.create(draft(3), within(2)),
  ]);
  assert.equal(both.filter(({ ok }) => ok).length, 1);
  assert.deepEqual(
    both.find(({ ok }) => !ok),
    { ok: false, error: "quota" },
  );
  assert.equal((await store.list(live())).length, 2);
}

async function refusesALiveAgentPastItsQuota(store: AgentStore, draft: Drafts): Promise<void> {
  for (const n of [1, 2]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the agents are made in their order
    assert.ok((await store.create(draft(n), live())).ok);
  }
  const [first, second] = [draft(1).id, draft(2).id];
  const live1 = { agentId: first, mode: "live", atMs: 5_000, expectedVersion: 0 } as const;
  assert.ok((await store.setMode(live1, within(1))).ok);
  const live2 = { ...live1, agentId: second };
  assert.deepEqual(await store.setMode(live2, within(1)), { ok: false, error: "quota" });
  assert.equal((await store.get(second, live()))?.agent.mode, "paper");
  assert.ok((await store.setMode({ ...live1, expectedVersion: 1 }, within(1))).ok);
  const stale = { ...live2, expectedVersion: 7 };
  assert.deepEqual(await store.setMode(stale, within(0)), { ok: false, error: "stale" });
  const unknown = { ...live2, agentId: fixtureId("agt", 9) };
  assert.deepEqual(await store.setMode(unknown, within(0)), { ok: false, error: "not_found" });
  const paper1 = { ...live1, mode: "paper", expectedVersion: 2 } as const;
  assert.ok((await store.setMode(paper1, within(0))).ok);
  assert.ok((await store.setMode(live2, within(1))).ok);
}

/**
 * The checks of an `AgentStore`'s quotas (decision 0431), on agent drafts by number: a create
 * past the install's agents and a switch to live past its live agents are `quota` and write
 * nothing, counted in the same write, so two racing for the last room never both pass.
 */
export function agentQuotaChecks(
  create: () => Promise<AgentStore>,
  draft: Drafts,
): readonly ContractCheck[] {
  return [
    checkOn("refuses an agent past its quota, after an id or name in use", create, async (store) =>
      refusesAnAgentPastItsQuota(store, draft),
    ),
    checkOn("takes one of two agents made at once for the last room", create, async (store) =>
      takesOneOfTwoForTheLastRoom(store, draft),
    ),
    checkOn("refuses a switch to live past the live agents' quota", create, async (store) =>
      refusesALiveAgentPastItsQuota(store, draft),
    ),
  ];
}
