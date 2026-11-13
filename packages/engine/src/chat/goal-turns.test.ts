import { createIdSource, idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { goalPushOf, inboxMessageViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createMemoryAgentInboxStore } from "../fakes/memory-agent-inbox-store.js";
import {
  createMemoryAgentStore,
  type MemoryAgentStoreOptions,
} from "../fakes/memory-agent-store.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createGoalTurnHandlers } from "./goal-turns.js";
import { createInboxHold } from "./inbox-hold.js";
import { createRunningTurns } from "./running-turns.js";

const runtime = testCallers.runtime;
const other = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-0000000000aa");

async function setUp(install?: MemoryAgentStoreOptions["install"]) {
  const clock = createManualClock(Date.UTC(2026, 10, 8, 12));
  const agents = createMemoryAgentStore(install === undefined ? {} : { install });
  await agents.create(testAgentDraft({}), testCall({}));
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const pushes: EnginePush[] = [];
  const agentInbox = createMemoryAgentInboxStore({ agents });
  const ids = createIdSource({ clock, random: createSeededRandom(1) });
  const handlers = createGoalTurnHandlers({
    agents,
    agentInbox,
    inboxHold: createInboxHold(),
    turns,
    ids,
    clock,
    publish: (push) => pushes.push(push),
    intentView: async () => Promise.resolve(undefined),
  });
  // The owner's first message opens the agent's chat.
  const opened = await agentInbox.add(
    {
      id: ids.next("msg"),
      agentId: testAgent,
      kind: "inbox/message",
      turnId: ids.next("trn"),
      payload: { text: "hi", surface: "telegram" },
      atMs: clock.now(),
      opens: ids.next("ses"),
    },
    testCall({}),
  );
  if (!opened.ok) {
    throw new Error("the chat did not open");
  }
  return { handlers, pushes, agents, session: opened.value.sessionId };
}

// Freezes the test agent, as `safety/freeze` does.
function freeze(agents: ReturnType<typeof createMemoryAgentStore>): void {
  const version = agents.agentNow(testAgent)?.version ?? 0;
  agents.freezeNow([{ agentId: testAgent, expectedVersion: version }], { atMs: 1, isFrozen: true });
}

const goalWords = "[binference: goal turn 2 of at most 50. Keep working on the goal.]";

function woken(pushes: readonly EnginePush[]) {
  return pushes
    .filter((push) => push.topic === "inbox")
    .map((push) => inboxMessageViewSchema.parse(push.data));
}

describe("goal turns", () => {
  it("wakes the agent's open chat with a goal turn, marked when the turn before it was", async () => {
    const test = await setUp();
    const args = {
      agent: testAgent,
      session: test.session,
      surface: "console" as const,
      text: goalWords,
      outsideContent: true,
    };
    const continued = await test.handlers["goal/continue"](testCall(args, runtime));
    expect(continued).toStrictEqual({ ok: true, value: {} });
    expect(woken(test.pushes)).toMatchObject([
      {
        kind: "inbox/message",
        session: test.session,
        text: goalWords,
        surface: "console",
        outsideContent: true,
        goalTurn: true,
      },
    ]);
  });

  it("refuses a goal turn of a frozen agent, so its runtime pauses the goal", async () => {
    const test = await setUp();
    freeze(test.agents);
    const args = {
      agent: testAgent,
      session: test.session,
      surface: "telegram" as const,
      text: goalWords,
      outsideContent: false,
    };
    expect(await test.handlers["goal/continue"](testCall(args, runtime))).toStrictEqual({
      ok: false,
      error: "agent.frozen",
    });
    expect(test.pushes).toStrictEqual([]);
  });

  it("refuses a goal turn with the breaker's code while the breaker holds the install", async () => {
    const test = await setUp({ frozenAt: () => undefined, breakerMark: { at: () => 1 } });
    const args = {
      agent: testAgent,
      session: test.session,
      surface: "telegram" as const,
      text: goalWords,
      outsideContent: false,
    };
    expect(await test.handlers["goal/continue"](testCall(args, runtime))).toStrictEqual({
      ok: false,
      error: "safety.breaker",
    });
    expect(test.pushes).toStrictEqual([]);
  });

  it("starts no goal turn in a chat the owner cleared since, nor for an unknown agent or any caller but the runtime", async () => {
    const test = await setUp();
    const args = {
      agent: testAgent,
      session: other,
      surface: "telegram" as const,
      text: goalWords,
      outsideContent: false,
    };
    expect(await test.handlers["goal/continue"](testCall(args, runtime))).toStrictEqual({
      ok: true,
      value: {},
    });
    const cli = { ...args, session: test.session };
    expect(await test.handlers["goal/continue"](testCall(cli, testCallers.cli))).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    const unknown = {
      ...cli,
      agent: idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000ff"),
    };
    expect(await test.handlers["goal/continue"](testCall(unknown, runtime))).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
    expect(test.pushes).toStrictEqual([]);
  });

  it("pushes a change of the goal on the agent's chat topic, its money as decimal text", async () => {
    const test = await setUp();
    const goal = {
      agent: testAgent,
      session: test.session,
      objective: "Find three tokens",
      status: "paused" as const,
      pauseReason: "goal_budget" as const,
      budgetUsdMicros: 2n ** 64n + 1n,
      spentUsdMicros: 2n ** 64n + 1n,
      goalTurns: 7,
      startedAt: 1,
      updatedAt: 2,
    };
    const args = { agent: testAgent, session: test.session, change: "paused" as const, goal };
    expect(await test.handlers["goal/show"](testCall(args, runtime))).toStrictEqual({
      ok: true,
      value: {},
    });
    expect(test.pushes.map((push) => push.topic)).toStrictEqual([`chat:${testAgent}`]);
    expect(test.pushes.map((push) => goalPushOf(push))).toStrictEqual([
      { kind: "chat/goal", ...args },
    ]);
    expect(await test.handlers["goal/show"](testCall(args, testCallers.cli))).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
  });
});
