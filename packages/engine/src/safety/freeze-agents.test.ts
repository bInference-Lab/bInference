import { err, type Id, idSchema } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import type { AgentRecord } from "../agents/agent-record.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentKind } from "../intents/intent-kind.js";
import type { IntentState } from "../intents/intent-state.js";
import {
  expectOk,
  testAgent,
  testAgentDraft,
  testNowMs,
  testSwap,
  testWallet,
} from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
  testCall,
} from "../operations/test-engine.js";
import type { AgentStore, IntentStore } from "../ports.js";
import { frozenNoticeKey } from "./freeze-agents.js";

const live = { signal: new AbortController().signal };
const second = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000002");

function intentId(n: number): Id<"int"> {
  return idSchema("int").parse(`int_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`);
}

// An intent stored as it stands in `state`, as if the money path had moved it there.
async function storeIntent(
  test: TestEngine,
  n: number,
  state: { readonly kind: IntentKind; readonly state: IntentState },
): Promise<Id<"int">> {
  const isRescue = state.kind === "rescue";
  const id = intentId(n);
  const created = await test.stores.intents.create(
    {
      id,
      agentId: testAgent,
      walletId: testWallet,
      ...state,
      request: isRescue ? { kind: "rescue" } : requestDocument.encode(testSwap()),
      hasOutsideContent: false,
      isPaper: !isRescue,
      proposer: "telegram",
      atMs: testNowMs,
      cause: { trigger: "propose", proposer: isRescue ? "owner" : "agent_runtime", by: "x" },
    },
    live,
  );
  expectOk(created);
  return id;
}

async function startWithTwoAgents(options: TestEngineOptions = {}): Promise<TestEngine> {
  const test = await startTestEngine(options);
  await test.stores.agents.create(testAgentDraft({ id: second, name: "second" }), live);
  return test;
}

async function proposeSwap(test: TestEngine): Promise<Id<"int">> {
  const proposed = await test.engine.handlers["intent/propose"](testCall(testSwap()));
  return expectOk(proposed).intent;
}

async function stateOf(test: TestEngine, id: Id<"int">): Promise<IntentState | undefined> {
  return (await test.stores.intents.get(id, live))?.state;
}

async function frozenTimes(test: TestEngine): Promise<readonly (number | undefined)[]> {
  const agents = await test.stores.agents.list(live);
  return agents.map((agent) => agent.frozenAtMs);
}

async function installFrozenAt(test: TestEngine): Promise<number | undefined> {
  return (await test.stores.install.read(live)).frozenAtMs;
}

function freeze(test: TestEngine, agent?: Id<"agt">) {
  return test.engine.handlers["safety/freeze"](testCall(agent === undefined ? {} : { agent }));
}

function frozenNotices(test: TestEngine) {
  return test.pushes.filter(({ topic }) => topic === "notice");
}

function archive(agent: AgentRecord): AgentRecord {
  return { ...agent, archivedAtMs: 1 };
}

// An agent store that lists every agent as archived.
function archivedOnly(store: AgentStore): AgentStore {
  return { ...store, list: async (call) => (await store.list(call)).map(archive) };
}

// An intent store whose first `times` freezes another write beats, and how often it was tried.
function beatenTimes(times: number) {
  const counted = { tries: 0 };
  const wrap = (store: IntentStore): IntentStore => ({
    ...store,
    async freeze(write, call) {
      counted.tries += 1;
      return counted.tries <= times ? err("stale") : store.freeze(write, call);
    },
  });
  return { wrap, tries: () => counted.tries };
}

describe("safety/freeze", () => {
  it("freezes every agent and cancels their unsigned intents, a rescue and a sent one left", async () => {
    const test = await startWithTwoAgents();
    const waiting = await proposeSwap(test);
    const confirmed = await storeIntent(test, 11, { kind: "swap", state: "confirmed" });
    const rescue = await storeIntent(test, 12, { kind: "rescue", state: "awaiting_confirmation" });
    const sending = await storeIntent(test, 13, { kind: "swap", state: "executing" });
    await expect(freeze(test)).resolves.toStrictEqual({ ok: true, value: { frozenAt: testNowMs } });
    await expect(frozenTimes(test)).resolves.toStrictEqual([testNowMs, testNowMs]);
    await expect(stateOf(test, waiting)).resolves.toBe("cancelled");
    await expect(stateOf(test, confirmed)).resolves.toBe("cancelled");
    await expect(stateOf(test, rescue)).resolves.toBe("awaiting_confirmation");
    await expect(stateOf(test, sending)).resolves.toBe("executing");
    const [card] = await test.stores.intents.cards(waiting, live);
    expect(card).toMatchObject({ closedAtMs: testNowMs, closeReason: "cancelled" });
    expect(test.pushes).toContainEqual({
      topic: "intent",
      kind: "card/closed",
      data: { intent: waiting, card: card?.id, reason: "cancelled" },
    });
    expect(frozenNotices(test).map((push) => push.data)).toStrictEqual([
      { key: "notice.frozen", agent: testAgent, values: { agent: "main", surface: "cli" } },
      { key: "notice.frozen", agent: second, values: { agent: "second", surface: "cli" } },
    ]);
    const entries = await test.stores.ledger.list({ after: 0, limit: 100 }, live);
    expect(entries.filter(({ kind }) => kind === "freeze")).toMatchObject([
      { agentId: testAgent, subject: testAgent, data: { surface: "cli" } },
      { agentId: second, subject: second, data: { surface: "cli" } },
      { data: { surface: "cli" } },
    ]);
    await expect(installFrozenAt(test)).resolves.toBe(testNowMs);
  });

  it("freezes the whole install, so an agent created later starts frozen until an unfreeze", async () => {
    const test = await startTestEngine();
    expectOk(await freeze(test));
    await test.clock.advance(5_000);
    const later = await test.stores.agents.create(
      testAgentDraft({ id: second, name: "second", atMs: test.clock.now() }),
      live,
    );
    expect(expectOk(later).agent.frozenAtMs).toBe(testNowMs + 5_000);
    await expect(frozenTimes(test)).resolves.toStrictEqual([testNowMs, testNowMs + 5_000]);
  });

  it("freezes an install with no active agent, which then answers with the install's time", async () => {
    const test = await startTestEngine({ agents: archivedOnly });
    await expect(freeze(test)).resolves.toStrictEqual({ ok: true, value: { frozenAt: testNowMs } });
    await test.clock.advance(5_000);
    await expect(freeze(test)).resolves.toStrictEqual({ ok: true, value: { frozenAt: testNowMs } });
    await expect(installFrozenAt(test)).resolves.toBe(testNowMs);
    const entries = await test.stores.ledger.list({ after: 0, limit: 100 }, live);
    expect(entries.filter(({ kind }) => kind === "freeze")).toHaveLength(1);
  });

  it("freezes only the agent a call names", async () => {
    const test = await startWithTwoAgents();
    const waiting = await proposeSwap(test);
    await expect(freeze(test, second)).resolves.toStrictEqual({
      ok: true,
      value: { frozenAt: testNowMs },
    });
    await expect(frozenTimes(test)).resolves.toStrictEqual([undefined, testNowMs]);
    await expect(stateOf(test, waiting)).resolves.toBe("awaiting_confirmation");
    expect(frozenNotices(test)).toHaveLength(1);
    await expect(installFrozenAt(test)).resolves.toBeUndefined();
  });

  it("keeps the first time and announces nothing when the agents are frozen already", async () => {
    const test = await startTestEngine();
    expectOk(await freeze(test));
    await test.clock.advance(5_000);
    await expect(freeze(test)).resolves.toStrictEqual({ ok: true, value: { frozenAt: testNowMs } });
    await expect(frozenTimes(test)).resolves.toStrictEqual([testNowMs]);
    expect(frozenNotices(test)).toHaveLength(1);
  });

  it("refuses every new trade of a frozen agent at the policy step", async () => {
    const test = await startTestEngine();
    expectOk(await freeze(test));
    const proposed = expectOk(await test.engine.handlers["intent/propose"](testCall(testSwap())));
    expect(proposed).toMatchObject({ state: "rejected_policy", outcome: { reason: "frozen" } });
  });

  it("refuses an unknown or archived agent", async () => {
    const unknown = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");
    const test = await startTestEngine({ agents: archivedOnly });
    await expect(freeze(test, unknown)).resolves.toStrictEqual(err("agent.not_found"));
    await expect(freeze(test, testAgent)).resolves.toStrictEqual(err("agent.archived"));
  });

  it("reads again and freezes when another write beat its first try", async () => {
    const beaten = beatenTimes(1);
    const test = await startTestEngine({ intents: beaten.wrap });
    const waiting = await proposeSwap(test);
    expectOk(await freeze(test));
    expect(beaten.tries()).toBe(2);
    await expect(stateOf(test, waiting)).resolves.toBe("cancelled");
  });

  it("throws, having written nothing, when other writes beat every try", async () => {
    const test = await startTestEngine({ intents: beatenTimes(1_000).wrap });
    const waiting = await proposeSwap(test);
    await expect(freeze(test)).rejects.toMatchObject({ code: "engine.freeze_contended" });
    await expect(frozenTimes(test)).resolves.toStrictEqual([undefined]);
    await expect(stateOf(test, waiting)).resolves.toBe("awaiting_confirmation");
  });
});

describe("the frozen notice", () => {
  const alarm = String.fromCodePoint(0x1f534);
  const english = createFormatter({ locale: "en", timeZone: "UTC" });

  it("names the agent and the surface it was frozen from, and where to unfreeze", () => {
    expect(english.message(frozenNoticeKey, { agent: "main", surface: "telegram" })).toBe(
      `${alarm} main is frozen from Telegram. Unfreeze in the CLI, the console or the Mini App.`,
    );
    expect(english.message(frozenNoticeKey, { agent: "main", surface: "cli" })).toBe(
      `${alarm} main is frozen from the CLI. Unfreeze in the CLI, the console or the Mini App.`,
    );
  });
});
