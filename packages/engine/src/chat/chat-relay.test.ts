import { idSchema } from "@binference/core";
import { type InboxMessageView, inboxMessageViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testSwap } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";

const runtime = testCallers.runtime;
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");

// Another client signed in with the `agent` scope, and the runtime of an earlier start.
const otherAgentClient: EngineCaller = {
  ...runtime,
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000077",
};
const earlierRuntime: EngineCaller = {
  ...runtime,
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000002",
};

function inboxPushes(test: TestEngine): readonly InboxMessageView[] {
  return test.pushes
    .filter((push) => push.topic === "inbox")
    .map((push) => inboxMessageViewSchema.parse(push.data));
}

function kinds(test: TestEngine, topic: string): readonly string[] {
  return test.pushes.filter((push) => push.topic === topic).map((push) => push.kind);
}

/**
 * A runtime that keeps each message it hears of once, from a push or from `inbox/list`, and takes
 * it, as the runtime spec's section 3.2 has it.
 */
function fakeRuntime(test: TestEngine) {
  const queue = new Map<string, InboxMessageView>();
  const handlers = test.engine.handlers;
  const receive = async (views: readonly InboxMessageView[]) => {
    const fresh = views.filter((view) => !queue.has(view.message));
    fresh.forEach((view) => queue.set(view.message, view));
    if (fresh.length > 0) {
      const messages = fresh.map((view) => view.message);
      expectOk(await handlers["inbox/take"](testCall({ messages }, runtime)));
    }
  };
  return {
    queue,
    heard: async () => receive(inboxPushes(test)),
    resync: async () =>
      receive(
        expectOk(await handlers["inbox/list"](testCall({ agent: testAgent }, runtime))).items,
      ),
  };
}

async function startTurn(test: TestEngine, outsideContent = false) {
  const { handlers } = test.engine;
  const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
  const args = { agent: testAgent, session, turn, messages: [message], outsideContent };
  return handlers["turn/start"](testCall(args, runtime));
}

describe("the chat relay", () => {
  it("stores a chat/post before it replies, and the runtime takes it once", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const posted = expectOk(
      await handlers["chat/post"](testCall({ agent: testAgent, text: "What moved today?" })),
    );
    const listed = expectOk(await handlers["inbox/list"](testCall({}, runtime))).items;
    expect(listed).toStrictEqual([
      {
        message: listed[0]?.message,
        kind: "inbox/message",
        agent: testAgent,
        session: posted.session,
        at: test.clock.now(),
        turn: posted.turn,
        text: "What moved today?",
        surface: "cli",
      },
    ]);
    const agentRuntime = fakeRuntime(test);
    await agentRuntime.heard();
    await agentRuntime.resync();
    await agentRuntime.heard();
    expect([...agentRuntime.queue.keys()]).toStrictEqual([listed[0]?.message]);
    expect(expectOk(await handlers["inbox/list"](testCall({}, runtime))).items).toStrictEqual([]);
    expect(kinds(test, "inbox")).toStrictEqual(["inbox/message"]);
  });

  it("keeps one session until a clear, which names the next", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const first = expectOk(await handlers["chat/post"](testCall({ agent: testAgent, text: "a" })));
    const cleared = expectOk(await handlers["chat/clear"](testCall({ agent: testAgent })));
    const after = expectOk(await handlers["chat/post"](testCall({ agent: testAgent, text: "b" })));
    expect(cleared.session).not.toBe(first.session);
    expect(after.session).toBe(cleared.session);
    expect(inboxPushes(test).map((view) => [view.kind, view.session])).toStrictEqual([
      ["inbox/message", first.session],
      ["inbox/clear", first.session],
      ["inbox/message", cleared.session],
    ]);
  });

  it("refuses chat for an unknown agent and stores nothing", async () => {
    const test = await startTestEngine();
    const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000099");
    const posted = await test.engine.handlers["chat/post"](
      testCall({ agent: stranger, text: "hi" }),
    );
    expect(posted).toStrictEqual({ ok: false, error: "agent.not_found" });
    expect(kinds(test, "inbox")).toStrictEqual([]);
  });

  it("sends exactly one inbox/intentSettled for an intent the runtime proposed", async () => {
    const test = await startTestEngine({ agent: { approvalMode: "auto" } });
    const { handlers } = test.engine;
    const intent = expectOk(await handlers["intent/propose"](testCall(testSwap(), runtime)));
    expect(intent.state).toBe("paper_filled");
    const owner = expectOk(await handlers["intent/propose"](testCall(testSwap())));
    const card = idSchema("crd").parse(owner.card?.card);
    const denied = await handlers["intent/deny"](testCall({ intent: owner.intent, card }));
    expect(expectOk(denied).state).toBe("denied");
    const settles = inboxPushes(test).filter((view) => view.kind === "inbox/intentSettled");
    expect(settles).toHaveLength(1);
    expect(settles[0]).toMatchObject({ intent: { intent: intent.intent, state: "paper_filled" } });
    const listed = expectOk(await handlers["inbox/list"](testCall({}, runtime))).items;
    expect(listed).toStrictEqual(settles);
  });

  it("sends no stop when the frozen agent runs no turn", async () => {
    const test = await startTestEngine();
    expectOk(await test.engine.handlers["safety/freeze"](testCall({ agent: testAgent })));
    expect(kinds(test, "inbox")).toStrictEqual([]);
  });

  it("sends the running turn a stop when the install freezes", async () => {
    const test = await startTestEngine();
    expectOk(await startTurn(test));
    expectOk(await test.engine.handlers["safety/freeze"](testCall({})));
    const stops = inboxPushes(test).filter((view) => view.kind === "inbox/stop");
    expect(stops).toMatchObject([{ kind: "inbox/stop", agent: testAgent, reason: "freeze" }]);
  });

  it("stores the owner's stop whether or not a turn runs", async () => {
    const test = await startTestEngine();
    expectOk(await test.engine.handlers["chat/stop"](testCall({ agent: testAgent })));
    expect(inboxPushes(test)).toMatchObject([{ kind: "inbox/stop", reason: "owner" }]);
  });

  it("accepts turn/start and turn/mark only from the runtime's current token", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const mark = { agent: testAgent, turn };
    for (const caller of [testCallers.cli, testCallers.mcp, otherAgentClient, earlierRuntime]) {
      const args = { agent: testAgent, session, turn, messages: [], outsideContent: false };
      // oxlint-disable-next-line eslint/no-await-in-loop -- one caller at a time
      expect(await handlers["turn/start"](testCall(args, caller))).toStrictEqual({
        ok: false,
        error: "auth.scope",
      });
      // oxlint-disable-next-line eslint/no-await-in-loop -- one caller at a time
      expect(await handlers["turn/mark"](testCall(mark, caller))).toStrictEqual({
        ok: false,
        error: "auth.scope",
      });
    }
    expect(test.turns.runningOf(testAgent)).toBeUndefined();
    const budget = (await test.stores.agents.get(testAgent, { signal: AbortSignal.timeout(1_000) }))
      ?.limits.modelBudgetUsdMicros;
    expect(await startTurn(test)).toStrictEqual({ ok: true, value: { budgetLeftMicros: budget } });
    expect(test.turns.markOf(runtime.credential, testAgent)).toStrictEqual({
      hasOutsideContent: false,
    });
    expectOk(await handlers["turn/mark"](testCall(mark, runtime)));
    expect(test.turns.markOf(runtime.credential, testAgent)).toStrictEqual({
      hasOutsideContent: true,
    });
  });

  it("refuses the agent's other calls from any token but the runtime's current one", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const say = { agent: testAgent, session, turn, text: "Done.", final: true };
    const caller = otherAgentClient;
    const refused = { ok: false, error: "auth.scope" };
    expect(await handlers["turn/say"](testCall(say, caller))).toStrictEqual(refused);
    expect(await handlers["turn/end"](testCall({ ...say, outcome: "ok" }, caller))).toStrictEqual(
      refused,
    );
    expect(await handlers["inbox/list"](testCall({}, caller))).toStrictEqual(refused);
    expect(await handlers["inbox/take"](testCall({ messages: [] }, caller))).toStrictEqual(refused);
    expect(kinds(test, `chat:${testAgent}`)).toStrictEqual([]);
  });

  it("puts the turn's start, text, status line and end on the agent's chat topic", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    expectOk(await startTurn(test));
    const say = { agent: testAgent, session, turn, text: "Done.", final: true };
    expectOk(await handlers["turn/say"](testCall(say, runtime)));
    const status = { agent: testAgent, turn, statusKey: "turn.proposalWaits" };
    expectOk(await handlers["turn/status"](testCall(status, runtime)));
    expectOk(
      await handlers["turn/end"](testCall({ agent: testAgent, turn, outcome: "ok" }, runtime)),
    );
    expect(kinds(test, `chat:${testAgent}`)).toStrictEqual([
      "chat/turnStarted",
      "chat/message",
      "chat/status",
      "chat/turnEnded",
    ]);
    expect(test.turns.runningOf(testAgent)).toBeUndefined();
  });

  it("refuses a mark of a turn that does not run", async () => {
    const test = await startTestEngine();
    const marked = await test.engine.handlers["turn/mark"](
      testCall({ agent: testAgent, turn }, runtime),
    );
    expect(marked).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });

  it("marks the running turn when a message with images arrives", async () => {
    const test = await startTestEngine();
    expectOk(await startTurn(test));
    const images = ["upload-1"];
    expectOk(
      await test.engine.handlers["chat/post"](testCall({ agent: testAgent, text: "", images })),
    );
    expect(test.turns.markOf(runtime.credential, testAgent)).toStrictEqual({
      hasOutsideContent: true,
    });
  });

  it("pages the untaken messages and refuses a cursor it did not give", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    for (const text of ["a", "b", "c"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- messages keep their order
      expectOk(await handlers["chat/post"](testCall({ agent: testAgent, text })));
      // oxlint-disable-next-line eslint/no-await-in-loop -- each message a millisecond later
      await test.clock.advance(1);
    }
    const first = expectOk(await handlers["inbox/list"](testCall({ limit: 2 }, runtime)));
    const cursor = String(first.next);
    const rest = expectOk(await handlers["inbox/list"](testCall({ cursor }, runtime)));
    expect([...first.items, ...rest.items]).toMatchObject([
      { text: "a" },
      { text: "b" },
      { text: "c" },
    ]);
    expect(rest.next).toBeUndefined();
    const bad = await handlers["inbox/list"](testCall({ cursor: "page-2" }, runtime));
    expect(bad).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });
});
