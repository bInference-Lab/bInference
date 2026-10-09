import assert from "node:assert/strict";
import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { AddressEntryRecord } from "../agents/address-entry-record.js";
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
    sendLevel: 2,
    bySurface: "cli",
  };
}

async function createsAgents(store: AgentStore): Promise<void> {
  const created = await store.create(draft(2), live());
  assert.ok(created.ok);
  const { agent, limits: stored, approvalMode, sendLevel } = created.value;
  const {
    atMs,
    limits: draftLimits,
    approvalMode: mode,
    sendLevel: level,
    bySurface,
    ...fields
  } = draft(2);
  assert.deepEqual(agent, { ...fields, createdAtMs: atMs, changedAtMs: atMs, version: 0 });
  assert.deepEqual(stored, { ...draftLimits, agentId: agent.id, changedAtMs: atMs, version: 0 });
  assert.deepEqual(approvalMode, {
    agentId: agent.id,
    mode,
    changedBySurface: bySurface,
    changedAtMs: atMs,
    version: 0,
  });
  assert.deepEqual(sendLevel, { agentId: agent.id, level, changedAtMs: atMs, version: 0 });
  assert.deepEqual(created.value.addressBook, []);
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

async function keepsPendingLimits(store: AgentStore): Promise<void> {
  await store.create(draft(1), live());
  const agentId = draft(1).id;
  const looser = { ...limits, perTradeUsdMicros: beyond64Bits, denyTokens: [] };
  const pending = { values: looser, atMs: 90_000_000 };
  const change = { agentId, limits, pending, atMs: 3_000, expectedVersion: 0 };
  const set = await store.setLimits(change, live());
  assert.deepEqual(set, {
    ok: true,
    value: { ...limits, agentId, pending, changedAtMs: 3_000, version: 1 },
  });
  assert.deepEqual((await store.get(agentId, live()))?.limits.pending, pending);
  const dropped = await store.setLimits(
    { agentId, limits, atMs: 4_000, expectedVersion: 1 },
    live(),
  );
  assert.deepEqual(dropped, {
    ok: true,
    value: { ...limits, agentId, changedAtMs: 4_000, version: 2 },
  });
  assert.equal((await store.get(agentId, live()))?.limits.pending, undefined);
}

async function setsMode(store: AgentStore): Promise<void> {
  await store.create(draft(1), live());
  const agentId = draft(1).id;
  const change = { agentId, mode: "live", atMs: 4_000, expectedVersion: 0 } as const;
  const set = await store.setMode(change, live());
  const { id, name, locale, models, notifications, atMs } = draft(1);
  const fields = { id, name, mode: "live", locale, models, notifications };
  const record = { ...fields, createdAtMs: atMs, changedAtMs: 4_000, version: 1 };
  assert.deepEqual(set, { ok: true, value: record });
  assert.deepEqual(await store.setMode({ ...change, mode: "paper" }, live()), {
    ok: false,
    error: "stale",
  });
  const unknown = { ...change, agentId: fixtureId("agt", 9) };
  assert.deepEqual(await store.setMode(unknown, live()), { ok: false, error: "not_found" });
  const stored = await store.get(agentId, live());
  assert.deepEqual(stored?.agent, record);
  assert.equal(stored?.approvalMode.version, 0);
  assert.equal(stored?.limits.version, 0);
}

async function setsSendLevel(store: AgentStore): Promise<void> {
  await store.create(draft(1), live());
  const agentId = draft(1).id;
  const pending = { level: 0, atMs: 90_000 } as const;
  const waiting = { agentId, level: 3, pending, atMs: 5_000, expectedVersion: 0 } as const;
  const record = { agentId, level: 3, pending, changedAtMs: 5_000, version: 1 };
  assert.deepEqual(await store.setSendLevel(waiting, live()), { ok: true, value: record });
  assert.deepEqual(await store.setSendLevel(waiting, live()), { ok: false, error: "stale" });
  const unknown = { ...waiting, agentId: fixtureId("agt", 9) };
  assert.deepEqual(await store.setSendLevel(unknown, live()), { ok: false, error: "not_found" });
  assert.deepEqual((await store.get(agentId, live()))?.sendLevel, record);
  const cleared = { agentId, level: 1, atMs: 6_000, expectedVersion: 1 } as const;
  const set = await store.setSendLevel(cleared, live());
  assert.deepEqual(set, { ok: true, value: { agentId, level: 1, changedAtMs: 6_000, version: 2 } });
  assert.deepEqual((await store.get(agentId, live()))?.sendLevel, set.ok ? set.value : undefined);
}

function entry(n: number, address: string): AddressEntryRecord {
  return {
    id: fixtureId("adr", n),
    agentId: fixtureId("agt", 1),
    account: accountRefSchema.parse(`fake:1:${address}`),
    label: `entry ${String(n)}`,
    usableAtMs: 90_000 + n,
    createdAtMs: 1_000 + n,
  };
}

async function keepsAddressBook(store: AgentStore): Promise<void> {
  await store.create(draft(1), live());
  const agentId = draft(1).id;
  const saved = { ...entry(2, "0xb"), inCeilingAtMs: 1_002 };
  assert.deepEqual(await store.addAddress(saved, live()), { ok: true, value: saved });
  assert.deepEqual(await store.addAddress(entry(1, "0xa"), live()), {
    ok: true,
    value: entry(1, "0xa"),
  });
  assert.deepEqual(await store.addAddress(entry(2, "0xc"), live()), { ok: false, error: "exists" });
  assert.deepEqual(await store.addAddress(entry(3, "0xb"), live()), { ok: false, error: "saved" });
  const stranger = { ...entry(4, "0xd"), agentId: fixtureId("agt", 9) };
  assert.deepEqual(await store.addAddress(stranger, live()), { ok: false, error: "not_found" });
  assert.deepEqual((await store.get(agentId, live()))?.addressBook, [entry(1, "0xa"), saved]);
}

async function removesAddresses(store: AgentStore): Promise<void> {
  await store.create(draft(1), live());
  const agentId = draft(1).id;
  await store.addAddress(entry(1, "0xa"), live());
  const removal = { id: entry(1, "0xa").id, atMs: 5_000 };
  assert.deepEqual(await store.removeAddress(removal, live()), {
    ok: true,
    value: entry(1, "0xa"),
  });
  assert.deepEqual(await store.removeAddress(removal, live()), { ok: false, error: "not_found" });
  const unknown = { id: fixtureId("adr", 9), atMs: 5_000 };
  assert.deepEqual(await store.removeAddress(unknown, live()), { ok: false, error: "not_found" });
  assert.deepEqual((await store.get(agentId, live()))?.addressBook, []);
  assert.deepEqual(await store.addAddress(entry(2, "0xa"), live()), {
    ok: true,
    value: entry(2, "0xa"),
  });
  assert.deepEqual(await store.addAddress(entry(1, "0xe"), live()), { ok: false, error: "exists" });
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
  const goLive = { agentId, mode: "live", atMs: 1, expectedVersion: 0 } as const;
  await assertRefusesAborted(async (options) => store.setMode(goLive, options));
  const locked = { agentId, level: 3, atMs: 1, expectedVersion: 0 } as const;
  await assertRefusesAborted(async (options) => store.setSendLevel(locked, options));
  await assertRefusesAborted(async (options) => store.addAddress(entry(1, "0xa"), options));
  const removal = { id: entry(1, "0xa").id, atMs: 1 };
  await assertRefusesAborted(async (options) => store.removeAddress(removal, options));
  assert.deepEqual(await store.list(live()), []);
}

/** The contract every `AgentStore` adapter passes. */
export function agentStoreContract(harness: AgentStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<AgentStore> => harness.create();
  return [
    checkOn(
      "creates an agent with its limits, approval mode and send level at version 0",
      create,
      createsAgents,
    ),
    checkOn("refuses an agent id or name in use", create, refusesTaken),
    checkOn("sets the approval mode under the version the changer read", create, setsApprovalMode),
    checkOn("sets limits under the version read, amounts beyond 64 bits exact", create, setsLimits),
    checkOn(
      "keeps looser limits that wait, and drops them when none do",
      create,
      keepsPendingLimits,
    ),
    checkOn("sets the mode under the agent row's version the changer read", create, setsMode),
    checkOn(
      "sets the send level and its pending level under the version read",
      create,
      setsSendLevel,
    ),
    checkOn(
      "keeps live address book entries, one per account, oldest first",
      create,
      keepsAddressBook,
    ),
    checkOn("removes an entry once, so its account may be added again", create, removesAddresses),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
