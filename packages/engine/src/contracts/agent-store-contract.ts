import assert from "node:assert/strict";
import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { AgentDraft } from "../agents/agent-record.js";
import type { LimitsValues } from "../agents/limits-record.js";
import type { AgentStore } from "../ports.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";

/** Makes a fresh, empty agent store for each check. */
export interface AgentStoreHarness {
  create(): Promise<AgentStore>;
}

// 2^64 + 1 does not fit a SQLite integer: amounts must round-trip as decimal text.
const beyond64Bits = 2n ** 64n + 1n;
const chain = chainRefSchema.parse("fake:1");
const token = assetRefSchema.parse("fake:1/token:a");

const limits: LimitsValues = {
  perTradeUsdMicros: 100_000_000n,
  rollingDayUsdMicros: beyond64Bits,
  slippageRegistryBps: bpsSchema.parse(50),
  slippageOtherBps: bpsSchema.parse(300),
  priceImpactBps: bpsSchema.parse(500),
  taxBps: bpsSchema.parse(1_000),
  liquidityFloorUsdMicros: 0n,
  minHealthFactorBp: 15_000,
  gasReserve: [{ chain, reserveBase: beyond64Bits }],
  venues: ["venue-a", "venue-b"],
  allowTokens: [],
  denyTokens: [token],
  modelBudgetUsdMicros: 5_000_000n,
  cardTradeExpiryS: 60,
  cardOtherExpiryS: 600,
  requoteAfterS: 10,
  requoteToleranceBps: bpsSchema.parse(50),
  orderExpiryDays: 30,
  copyPerBuyUsdMicros: 20_000_000n,
  copyPerLeaderDayUsdMicros: 100_000_000n,
};

function draft(n: number, name = `agent ${String(n)}`): AgentDraft {
  return {
    id: fixtureId("agt", n),
    name,
    mode: "paper",
    locale: "zh",
    models: { main: "router:default" },
    notifications: { fills: true },
    atMs: 1_000 + n,
    limits,
    approvalMode: "manual",
    bySurface: "cli",
  };
}

async function createsAgents(store: AgentStore): Promise<void> {
  const created = await store.create(draft(2), live());
  assert.ok(created.ok);
  const { agent, limits: stored, approvalMode } = created.value;
  const { atMs, limits: draftLimits, approvalMode: mode, bySurface, ...fields } = draft(2);
  assert.deepEqual(agent, { ...fields, createdAtMs: atMs, changedAtMs: atMs, version: 0 });
  assert.deepEqual(stored, { ...draftLimits, agentId: agent.id, changedAtMs: atMs, version: 0 });
  assert.deepEqual(approvalMode, {
    agentId: agent.id,
    mode,
    changedBySurface: bySurface,
    changedAtMs: atMs,
    version: 0,
  });
  assert.deepEqual(await store.get(agent.id, live()), created.value);
  assert.equal(await store.get(fixtureId("agt", 9), live()), undefined);
  await store.create(draft(1), live());
  const listed = await store.list(live());
  assert.deepEqual(
    listed.map((item) => item.id),
    [draft(1).id, draft(2).id],
  );
}

async function refusesTaken(store: AgentStore): Promise<void> {
  await store.create(draft(1), live());
  assert.deepEqual(await store.create(draft(1, "other"), live()), { ok: false, error: "exists" });
  assert.deepEqual(await store.create(draft(2, "agent 1"), live()), {
    ok: false,
    error: "name_taken",
  });
  assert.equal((await store.list(live())).length, 1);
}

async function setsApprovalMode(store: AgentStore): Promise<void> {
  await store.create(draft(1), live());
  const agentId = draft(1).id;
  const change = { agentId, mode: "auto", bySurface: "console", atMs: 2_000 } as const;
  const set = await store.setApprovalMode({ ...change, expectedVersion: 0 }, live());
  const record = { agentId, mode: "auto", changedBySurface: "console", changedAtMs: 2_000 };
  assert.deepEqual(set, { ok: true, value: { ...record, version: 1 } });
  const stale = await store.setApprovalMode(
    { ...change, mode: "manual", expectedVersion: 0 },
    live(),
  );
  assert.deepEqual(stale, { ok: false, error: "stale" });
  const unknown = { ...change, agentId: fixtureId("agt", 9), expectedVersion: 0 };
  assert.deepEqual(await store.setApprovalMode(unknown, live()), { ok: false, error: "not_found" });
  assert.equal((await store.get(agentId, live()))?.approvalMode.mode, "auto");
}

async function setsLimits(store: AgentStore): Promise<void> {
  await store.create(draft(1), live());
  const agentId = draft(1).id;
  const raised = { ...limits, perTradeUsdMicros: beyond64Bits, allowTokens: [token], venues: [] };
  const change = { agentId, limits: raised, atMs: 3_000, expectedVersion: 0 };
  const set = await store.setLimits(change, live());
  assert.deepEqual(set, {
    ok: true,
    value: { ...raised, agentId, changedAtMs: 3_000, version: 1 },
  });
  assert.deepEqual(await store.setLimits(change, live()), { ok: false, error: "stale" });
  const unknown = { ...change, agentId: fixtureId("agt", 9) };
  assert.deepEqual(await store.setLimits(unknown, live()), { ok: false, error: "not_found" });
  assert.ok(set.ok);
  assert.deepEqual((await store.get(agentId, live()))?.limits, set.value);
}

async function refusesAborted(store: AgentStore): Promise<void> {
  const agentId = draft(1).id;
  const mode = { agentId, mode: "auto", bySurface: "cli", atMs: 1, expectedVersion: 0 } as const;
  await assertRefusesAborted(async (options) => store.create(draft(1), options));
  await assertRefusesAborted(async (options) => store.get(agentId, options));
  await assertRefusesAborted(async (options) => store.list(options));
  await assertRefusesAborted(async (options) => store.setApprovalMode(mode, options));
  const change = { agentId, limits, atMs: 1, expectedVersion: 0 };
  await assertRefusesAborted(async (options) => store.setLimits(change, options));
  assert.deepEqual(await store.list(live()), []);
}

/** The contract every `AgentStore` adapter passes. */
export function agentStoreContract(harness: AgentStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<AgentStore> => harness.create();
  return [
    checkOn(
      "creates an agent with its limits and approval mode at version 0",
      create,
      createsAgents,
    ),
    checkOn("refuses an agent id or name in use", create, refusesTaken),
    checkOn("sets the approval mode under the version the changer read", create, setsApprovalMode),
    checkOn("sets limits under the version read, amounts beyond 64 bits exact", create, setsLimits),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
