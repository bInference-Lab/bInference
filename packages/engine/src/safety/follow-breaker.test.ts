import { type Id, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createMemoryBreaker, type MemoryBreaker } from "../fakes/memory-breaker.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentKind } from "../intents/intent-kind.js";
import type { IntentState } from "../intents/intent-state.js";
import { expectOk, testAgent, testNowMs, testSwap, testWallet } from "../intents/test-intents.js";
import { startTestEngine, testCall, type TestEngine } from "../operations/test-engine.js";

const live = { signal: new AbortController().signal };

function intentId(n: number): Id<"int"> {
  return idSchema("int").parse(`int_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`);
}

// An intent stored as it stands in `state`, as if the money path or a stop had left it there.
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

async function stateOf(test: TestEngine, id: Id<"int">): Promise<IntentState | undefined> {
  return (await test.stores.intents.get(id, live))?.state;
}

async function markOf(test: TestEngine) {
  const facts = await test.stores.install.read(live);
  return [facts.breakerAtMs, facts.breakerVersion];
}

// The install's own entries of the breaker's pulls and lifts, oldest first.
async function ledgerKinds(test: TestEngine): Promise<readonly string[]> {
  const entries = await test.stores.ledger.list({ after: 0, limit: 100 }, live);
  return entries
    .filter(
      (entry) => entry.agentId === undefined && JSON.stringify(entry.data).includes("breaker"),
    )
    .map((entry) => entry.kind);
}

async function startHeld(): Promise<{
  readonly test: TestEngine;
  readonly breaker: MemoryBreaker;
}> {
  const breaker = createMemoryBreaker();
  return { test: await startTestEngine({ breaker }), breaker };
}

describe("following the breaker", () => {
  it("writes nothing while the breaker never moved", async () => {
    const { test } = await startHeld();
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({ outcome: "kept" });
    await expect(markOf(test)).resolves.toStrictEqual([undefined, undefined]);
    expect(test.pushes).toStrictEqual([]);
  });

  it("cancels every unsigned intent but a rescue at the pull and stops running turns", async () => {
    const { test, breaker } = await startHeld();
    const waiting = await storeIntent(test, 1, { kind: "swap", state: "awaiting_confirmation" });
    const confirmed = await storeIntent(test, 2, { kind: "swap", state: "confirmed" });
    const sending = await storeIntent(test, 3, { kind: "swap", state: "executing" });
    const rescue = await storeIntent(test, 4, { kind: "rescue", state: "awaiting_confirmation" });
    breaker.pull(testNowMs);
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({ outcome: "pulled" });
    await expect(stateOf(test, waiting)).resolves.toBe("cancelled");
    await expect(stateOf(test, confirmed)).resolves.toBe("cancelled");
    await expect(stateOf(test, sending)).resolves.toBe("executing");
    await expect(stateOf(test, rescue)).resolves.toBe("awaiting_confirmation");
    await expect(markOf(test)).resolves.toStrictEqual([testNowMs, 1]);
    await expect(ledgerKinds(test)).resolves.toStrictEqual(["freeze"]);
    const inbox = await test.stores.agentInbox.untaken({ agentId: testAgent, limit: 10 }, live);
    expect(inbox.map(({ kind }) => kind)).toContain("inbox/stop");
  });

  it("applies each version once, and a lagging copy changes nothing", async () => {
    const { test, breaker } = await startHeld();
    breaker.pull(testNowMs);
    await test.engine.followBreaker(live);
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({ outcome: "kept" });
    breaker.pull(testNowMs + 5);
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({ outcome: "moved" });
    breaker.answer({ pulled: false, version: 1 });
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({ outcome: "kept" });
    await expect(markOf(test)).resolves.toStrictEqual([testNowMs, 2]);
    await expect(ledgerKinds(test)).resolves.toStrictEqual(["freeze"]);
  });

  it("lifts only the breaker's hold, the owner's own freeze kept", async () => {
    const { test, breaker } = await startHeld();
    breaker.pull(testNowMs);
    await test.engine.followBreaker(live);
    await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent }));
    breaker.lift(testNowMs + 1);
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({ outcome: "lifted" });
    await expect(markOf(test)).resolves.toStrictEqual([undefined, 2]);
    const [agent] = await test.stores.agents.list(live);
    expect([agent?.frozenAtMs, agent?.breakerAtMs]).toStrictEqual([testNowMs, undefined]);
    await expect(ledgerKinds(test)).resolves.toStrictEqual(["freeze", "unfreeze"]);
  });

  it("keeps the state applied last while its source does not answer", async () => {
    const { test, breaker } = await startHeld();
    breaker.pull(testNowMs);
    await test.engine.followBreaker(live);
    breaker.fail("breaker.unreadable");
    breaker.lift(testNowMs + 1);
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({
      outcome: "unread",
      errorCode: "breaker.unreadable",
    });
    await expect(markOf(test)).resolves.toStrictEqual([testNowMs, 1]);
  });
});

describe("following the breaker across a restart", () => {
  it("holds every agent from the start and writes nothing again", async () => {
    const { test, breaker } = await startHeld();
    breaker.pull(testNowMs);
    await test.engine.followBreaker(live);
    const restarted = test.restart();
    const [agent] = await test.stores.agents.list(live);
    expect(agent?.frozenAtMs).toBe(testNowMs);
    await expect(restarted.followBreaker(live)).resolves.toStrictEqual({ outcome: "kept" });
    await expect(ledgerKinds(test)).resolves.toStrictEqual(["freeze"]);
  });

  it("cancels a confirmed intent a stop left when the breaker was pulled while stopped", async () => {
    const { test, breaker } = await startHeld();
    const confirmed = await storeIntent(test, 2, { kind: "swap", state: "confirmed" });
    breaker.pull(testNowMs);
    const restarted = test.restart();
    await expect(restarted.followBreaker(live)).resolves.toStrictEqual({ outcome: "pulled" });
    await expect(stateOf(test, confirmed)).resolves.toBe("cancelled");
  });

  it("writes only the version for a pull and a lift both missed while stopped", async () => {
    const { test, breaker } = await startHeld();
    breaker.pull(testNowMs);
    breaker.lift(testNowMs + 1);
    const restarted = test.restart();
    await expect(restarted.followBreaker(live)).resolves.toStrictEqual({ outcome: "moved" });
    await expect(markOf(test)).resolves.toStrictEqual([undefined, 2]);
    await expect(ledgerKinds(test)).resolves.toStrictEqual([]);
  });
});
