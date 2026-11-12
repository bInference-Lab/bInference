import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { AgentRecord } from "../agents/agent-record.js";
import { createFakeCommandRunner } from "../fakes/fake-command-runner.js";
import { expectOk, testAgent, testAgentDraft, testToken } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import type { AgentStore } from "../ports.js";
import { openShell } from "../shell/test-shell.js";
import type { RuntimeChats, RuntimeChatsDeleted } from "./chat-delete.js";

const runtime = testCallers.runtime;
const live = { signal: new AbortController().signal };
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a2");
const archived = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a3");

const runtimeDeleted: RuntimeChatsDeleted = {
  sessions: 2,
  turns: 5,
  events: 30,
  messages: 4,
  goals: 1,
  progressNotes: 1,
  helpers: 1,
};

/** What the fake runtime saw of the engine as each delete reached it. */
interface Seen {
  readonly agents: (readonly Id<"agt">[])[];
  readonly untaken: number[];
  readonly openQuestions: number[];
}

/** How the fake runtime answers. */
interface RuntimeAnswer {
  readonly answer?: Result<RuntimeChatsDeleted, ProtocolErrorCode>;
  readonly up?: boolean;
  /** What its delete waits for once it read the engine, as a turn that takes a while to end. */
  readonly waits?: Promise<void>;
}

/** A promise the test settles when it chooses. */
interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
}

function gate(): Gate {
  const opener = { open: (): void => undefined };
  const promise = new Promise<void>((resolve) => {
    opener.open = resolve;
  });
  return { promise, open: () => opener.open() };
}

// Whether a call still waits once the work queued before this check had its turns: the clock lets
// every await chain of the in-memory stores run, so a call that nothing holds has answered by then.
async function isWaiting(test: TestEngine, call: Promise<unknown>): Promise<boolean> {
  const state = { isSettled: false };
  const settled = (): void => {
    state.isSettled = true;
  };
  void call.then(settled, settled);
  await test.clock.advance(0);
  return !state.isSettled;
}

// The agent as the store lists it, the `archived` agent archived.
function listed(agent: AgentRecord): AgentRecord {
  return agent.id === archived ? Object.assign({}, agent, { archivedAtMs: 1 }) : agent;
}

// An agent store that lists the `archived` agent as archived.
function withArchived(store: AgentStore): AgentStore {
  return { ...store, list: async (call) => (await store.list(call)).map(listed) };
}

// A test engine whose agent's shell runs `serve` until a stop, beside a fake runtime's side that
// reads the engine's inbox and questions as a delete reaches it.
async function deletionEngine(runtimeAnswer: RuntimeAnswer = {}) {
  const seen: Seen = { agents: [], untaken: [], openQuestions: [] };
  const holder: { test?: TestEngine } = {};
  const reached = gate();
  const chats: RuntimeChats = {
    isUp: () => runtimeAnswer.up ?? true,
    async delete(agents, options) {
      const stores = holder.test?.stores;
      seen.agents.push([...agents]);
      seen.untaken.push((await stores?.agentInbox.untaken({ limit: 50 }, options))?.length ?? -1);
      const open = await stores?.questions.openOf(testAgent, options);
      seen.openQuestions.push(open === undefined ? 0 : 1);
      reached.open();
      await runtimeAnswer.waits;
      return runtimeAnswer.answer ?? ok(runtimeDeleted);
    },
  };
  const runner = createFakeCommandRunner({ script: { serve: { kind: "runs", output: "" } } });
  const shell = { runner, settings: () => openShell };
  const test = await startTestEngine({ shell, runtimeChats: chats, agents: withArchived });
  holder.test = test;
  const { handlers } = test.engine;
  const args = { agent: testAgent, command: "serve", background: true } as const;
  const started = expectOk(await handlers["shell/run"](testCall(args, runtime)));
  const poll = async () =>
    handlers["shell/job"](
      testCall({ agent: testAgent, job: started.job, action: "poll" } as const, runtime),
    );
  return { test, poll, seen, reached: reached.promise };
}

// The owner's message, a running turn of the agent and its open question; answers the session the
// message opened.
async function chatOf(test: TestEngine): Promise<Id<"ses">> {
  const { handlers } = test.engine;
  const posted = await handlers["chat/post"](testCall({ agent: testAgent, text: "watch BNB" }));
  const start = { agent: testAgent, session, turn, messages: [message], outsideContent: false };
  expectOk(await handlers["turn/start"](testCall(start, runtime)));
  const asked = { agent: testAgent, session, turn, text: "Which?", choices: ["One", "Two"] };
  expectOk(await handlers["turn/ask"](testCall(asked, runtime)));
  return expectOk(posted).session;
}

// A deletion of the agent's chats whose runtime side waits until the test lets it end.
async function heldDeletion() {
  const runtimeEnd = gate();
  const engine = await deletionEngine({ waits: runtimeEnd.promise });
  const old = await chatOf(engine.test);
  const deleting = engine.test.engine.handlers["chat/delete"](testCall({ agent: testAgent }));
  await engine.reached;
  return { ...engine, old, deleting, end: runtimeEnd.open };
}

// Where each push of these kinds came, in the order the engine published them.
function placesOf(test: TestEngine, kinds: readonly string[]): readonly string[] {
  return test.pushes.map((push) => push.kind).filter((kind) => kinds.includes(kind));
}

function pushed(test: TestEngine, kind: string): readonly unknown[] {
  return test.pushes.filter((push) => push.kind === kind).map((push) => push.data);
}

describe("chat/delete", () => {
  it("stops the agent's commands and lets go its inbox and question before the runtime deletes", async () => {
    const { test, poll, seen } = await deletionEngine();
    await chatOf(test);
    const deleted = await test.engine.handlers["chat/delete"](testCall({ agent: testAgent }));
    expect(deleted).toStrictEqual(
      ok({ agents: [testAgent], ...runtimeDeleted, inboxMessages: 1, questions: 1 }),
    );
    expect(seen).toStrictEqual({ agents: [[testAgent]], untaken: [0], openQuestions: [0] });
    await test.clock.advance(0);
    expect(await poll()).toMatchObject({
      ok: true,
      value: { status: "ended", stoppedBy: "owner" },
    });
    expect(await test.stores.agentInbox.openSession(testAgent, live)).toBeUndefined();
    expect(pushed(test, "chat/questionClosed")).toMatchObject([{ closeReason: "cleared" }]);
    expect(pushed(test, "chat/deleted")).toStrictEqual([{ agent: testAgent }]);
  });

  it("deletes the chats of every agent not archived when it names none", async () => {
    const { test, seen } = await deletionEngine();
    await test.stores.agents.create(testAgentDraft({ id: other, name: "other" }), live);
    await test.stores.agents.create(testAgentDraft({ id: archived, name: "gone" }), live);
    const deleted = expectOk(await test.engine.handlers["chat/delete"](testCall({})));
    const both = [testAgent, other].toSorted();
    expect(deleted.agents.toSorted()).toStrictEqual(both);
    expect(seen.agents.map((agents) => agents.toSorted())).toStrictEqual([both]);
    expect(pushed(test, "chat/deleted")).toHaveLength(2);
  });

  it("refuses while the runtime is down, and changes nothing", async () => {
    const { test, poll, seen } = await deletionEngine({ up: false });
    await chatOf(test);
    const refused = await test.engine.handlers["chat/delete"](testCall({ agent: testAgent }));
    expect(refused).toStrictEqual(err("chat.needs_runtime"));
    expect(seen.agents).toStrictEqual([]);
    expect(await test.stores.agentInbox.untaken({ limit: 50 }, live)).toHaveLength(1);
    expect(await test.stores.questions.openOf(testAgent, live)).toBeDefined();
    expect(await poll()).toMatchObject({ ok: true, value: { status: "running" } });
  });

  it("refuses for want of a runtime when the composition gives it none", async () => {
    const test = await startTestEngine();
    const refused = await test.engine.handlers["chat/delete"](testCall({ agent: testAgent }));
    expect(refused).toStrictEqual(err("chat.needs_runtime"));
  });

  it("refuses an agent the engine does not know before anything changes", async () => {
    const { test, poll, seen } = await deletionEngine();
    const refused = await test.engine.handlers["chat/delete"](testCall({ agent: other }));
    expect(refused).toStrictEqual(err("agent.not_found"));
    expect(seen.agents).toStrictEqual([]);
    expect(await poll()).toMatchObject({ ok: true, value: { status: "running" } });
  });

  it("answers the route's failure and tells no surface the chats went", async () => {
    const { test } = await deletionEngine({ answer: err("engine.timeout") });
    await chatOf(test);
    const failed = await test.engine.handlers["chat/delete"](testCall({ agent: testAgent }));
    expect(failed).toStrictEqual(err("engine.timeout"));
    expect(pushed(test, "chat/deleted")).toStrictEqual([]);
  });
});

describe("chat/delete's hold of the agent's new messages", () => {
  it("holds an owner's message sent while the runtime deletes, then stores it in a new chat", async () => {
    const { test, old, deleting, end } = await heldDeletion();
    const posting = test.engine.handlers["chat/post"](
      testCall({ agent: testAgent, text: "and now?" }),
    );
    expect(await isWaiting(test, posting)).toBe(true);
    end();
    expectOk(await deleting);
    const posted = expectOk(await posting);
    expect(posted.session).not.toBe(old);
    expect(placesOf(test, ["chat/deleted", "inbox/message"]).slice(-2)).toStrictEqual([
      "chat/deleted",
      "inbox/message",
    ]);
    const untaken = await test.stores.agentInbox.untaken({ limit: 50 }, live);
    expect(untaken.map(({ sessionId, payload }) => [sessionId, payload])).toMatchObject([
      [posted.session, { text: "and now?" }],
    ]);
  });

  it("holds a schedule's run while the runtime deletes, then wakes the agent in a new chat", async () => {
    const { test, deleting, end } = await heldDeletion();
    const when = { cron: "* * * * *" };
    const args = { agent: testAgent, when, prompt: "Check BNB." };
    expectOk(await test.engine.handlers["schedule/create"](testCall(args)));
    await test.clock.advance(60_000);
    const running = test.engine.runSchedules(testCall({}));
    expect(await isWaiting(test, running)).toBe(true);
    end();
    expectOk(await deleting);
    await running;
    expect(placesOf(test, ["chat/deleted", "inbox/scheduleDue"])).toStrictEqual([
      "chat/deleted",
      "inbox/scheduleDue",
    ]);
    const untaken = await test.stores.agentInbox.untaken({ limit: 50 }, live);
    expect(untaken.map(({ kind }) => kind)).toStrictEqual(["inbox/scheduleDue"]);
  });

  it("holds a price alert's wake-up while the runtime deletes, then wakes the agent after", async () => {
    const { test, deleting, end } = await heldDeletion();
    const condition = {
      kind: "price",
      asset: testToken,
      direction: "below",
      price: 900_000n,
    } as const;
    const args = { agent: testAgent, condition, wake: true } as const;
    expectOk(await test.engine.handlers["alert/create"](testCall(args)));
    const price = { numerator: 800_000n, denominator: 10n ** 6n };
    const seen = {
      token: testToken,
      usdPerBaseUnit: price,
      decimals: 6,
      isThin: false,
      readAtMs: 0,
    };
    const firing = test.engine.alerts.seePrice(seen, live);
    expect(await isWaiting(test, firing)).toBe(true);
    end();
    expectOk(await deleting);
    expect(await firing).toMatchObject([{ woke: true }]);
    expect(placesOf(test, ["chat/deleted", "inbox/alertFired"])).toStrictEqual([
      "chat/deleted",
      "inbox/alertFired",
    ]);
  });

  it("drops a helper's report the runtime sends while it deletes, at once and unstored", async () => {
    const { test, old, deleting, end } = await heldDeletion();
    const report = {
      agent: testAgent,
      helper: old,
      surface: "telegram",
      outsideContent: false,
    } as const;
    const ended = test.engine.handlers["helper/ended"](
      testCall({ ...report, text: "[Your helper found nothing new.]" } as const, runtime),
    );
    expect(await isWaiting(test, ended)).toBe(false);
    expect(await ended).toStrictEqual(ok({}));
    end();
    expectOk(await deleting);
    expect(await test.stores.agentInbox.untaken({ limit: 50 }, live)).toStrictEqual([]);
  });
});
