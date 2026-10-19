import { idSchema } from "@binference/core";
import { type InboxMessageView, inboxMessageViewSchema } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import { questionOpenMs } from "./question-record.js";

const runtime = testCallers.runtime;
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const choices = ["Take-profit at +50%", "Stop-loss at -20%"];

function inboxPushes(test: TestEngine): readonly InboxMessageView[] {
  return test.pushes
    .filter((push) => push.topic === "inbox")
    .map((push) => inboxMessageViewSchema.parse(push.data));
}

function chatPushes(test: TestEngine, kind: string): readonly unknown[] {
  return test.pushes
    .filter((push) => push.topic === `chat:${testAgent}` && push.kind === kind)
    .map((push) => push.data);
}

async function startTurn(test: TestEngine) {
  const args = { agent: testAgent, session, turn, messages: [message], outsideContent: false };
  expectOk(await test.engine.handlers["turn/start"](testCall(args, runtime)));
}

async function ask(test: TestEngine, text = "Which exit should I set for PEPE first?") {
  const args = { agent: testAgent, session, turn, text, choices };
  return test.engine.handlers["turn/ask"](testCall(args, runtime));
}

async function asked(test: TestEngine) {
  await startTurn(test);
  return expectOk(await ask(test));
}

describe("the agent's questions", () => {
  it("asks in the running turn and draws the question on every chat surface", async () => {
    const test = await startTestEngine();
    await startTurn(test);
    const view = expectOk(await ask(test));
    expect(view).toStrictEqual({
      question: view.question,
      agent: testAgent,
      session,
      turn,
      text: "Which exit should I set for PEPE first?",
      choices,
      state: "open",
      createdAt: test.clock.now(),
      closesAt: test.clock.now() + questionOpenMs,
    });
    expect(chatPushes(test, "chat/question")).toStrictEqual([view]);
  });

  it("refuses a question outside the agent's running turn, or from another caller", async () => {
    const test = await startTestEngine();
    expect(await ask(test)).toStrictEqual({ ok: false, error: "protocol.bad_args" });
    await startTurn(test);
    const args = { agent: testAgent, session, turn, text: "Sell?", choices };
    const stranger = { ...runtime, credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000077" };
    const refused = await test.engine.handlers["turn/ask"](testCall(args, stranger));
    expect(refused).toStrictEqual({ ok: false, error: "auth.scope" });
    expect(chatPushes(test, "chat/question")).toStrictEqual([]);
  });

  it("takes the first answer once; a second one changes nothing", async () => {
    const test = await startTestEngine();
    const view = await asked(test);
    const { handlers } = test.engine;
    const args = { agent: testAgent, question: view.question, choice: 1 };
    const answered = expectOk(await handlers["chat/answer"](testCall(args)));
    const again = await handlers["chat/answer"](testCall({ ...args, choice: 0 }));
    expect(again).toStrictEqual({ ok: false, error: "question.closed" });
    const listed = expectOk(await handlers["inbox/list"](testCall({}, runtime))).items;
    expect(listed).toStrictEqual([
      {
        message: listed[0]?.message,
        kind: "inbox/message",
        agent: testAgent,
        session: answered.session,
        at: test.clock.now(),
        turn: answered.turn,
        text: "Stop-loss at -20%",
        surface: "cli",
        answer: { question: view.question, choice: 1 },
      },
    ]);
    expect(inboxPushes(test)).toStrictEqual(listed);
    expect(chatPushes(test, "chat/questionClosed")).toStrictEqual([
      {
        agent: testAgent,
        question: view.question,
        state: "answered",
        answer: { choice: 1, surface: "cli", at: test.clock.now() },
      },
    ]);
  });

  it("takes the owner's next message as the answer, written instead of a choice", async () => {
    const test = await startTestEngine();
    const view = await asked(test);
    const { handlers } = test.engine;
    const text = "Both, one after the other";
    expectOk(await handlers["chat/post"](testCall({ agent: testAgent, text })));
    expect(inboxPushes(test)).toStrictEqual([
      expect.objectContaining({ kind: "inbox/message", text, surface: "cli" }),
    ]);
    expect(chatPushes(test, "chat/questionClosed")).toStrictEqual([
      {
        agent: testAgent,
        question: view.question,
        state: "answered",
        answer: { typed: text, surface: "cli", at: test.clock.now() },
      },
    ]);
    const late = { agent: testAgent, question: view.question, choice: 0 };
    expect(await handlers["chat/answer"](testCall(late))).toStrictEqual({
      ok: false,
      error: "question.closed",
    });
    expectOk(await handlers["chat/post"](testCall({ agent: testAgent, text: "and more" })));
    expect(inboxPushes(test)).toHaveLength(2);
  });

  it("closes the open question when a newer one comes, or the chat is cleared", async () => {
    const test = await startTestEngine();
    const first = await asked(test);
    const second = expectOk(await ask(test, "Sell now?"));
    expectOk(await test.engine.handlers["chat/clear"](testCall({ agent: testAgent })));
    expect(chatPushes(test, "chat/questionClosed")).toStrictEqual([
      { agent: testAgent, question: first.question, state: "closed", closeReason: "replaced" },
      { agent: testAgent, question: second.question, state: "closed", closeReason: "cleared" },
    ]);
  });

  it("closes a question 24 hours old at its first touch, storing no answer", async () => {
    const test = await startTestEngine();
    const view = await asked(test);
    await test.clock.advance(questionOpenMs);
    const args = { agent: testAgent, question: view.question, choice: 0 };
    const late = await test.engine.handlers["chat/answer"](testCall(args));
    expect(late).toStrictEqual({ ok: false, error: "question.closed" });
    expect(chatPushes(test, "chat/questionClosed")).toStrictEqual([
      { agent: testAgent, question: view.question, state: "closed", closeReason: "expired" },
    ]);
    expect(inboxPushes(test)).toStrictEqual([]);
  });

  it("refuses a choice the question lacks, and a question of another agent", async () => {
    const test = await startTestEngine();
    const view = await asked(test);
    const { handlers } = test.engine;
    const beyond = { agent: testAgent, question: view.question, choice: 3 };
    expect(await handlers["chat/answer"](testCall(beyond))).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    const unknown = idSchema("qst").parse("qst_0190f1c2-3a4b-7c5d-8e6f-000000000099");
    const missing = { agent: testAgent, question: unknown, choice: 0 };
    expect(await handlers["chat/answer"](testCall(missing))).toStrictEqual({
      ok: false,
      error: "question.not_found",
    });
    expect(inboxPushes(test)).toStrictEqual([]);
  });
});

async function read(test: TestEngine) {
  return test.engine.handlers["chat/openQuestion"](testCall({ agent: testAgent }));
}

describe("chat/openQuestion", () => {
  it("answers the agent's open question, and none once it is answered", async () => {
    const test = await startTestEngine();
    expect(expectOk(await read(test))).toStrictEqual({});
    const view = await asked(test);
    expect(expectOk(await read(test))).toStrictEqual({ question: view });
    const answer = { agent: testAgent, question: view.question, choice: 0 };
    expectOk(await test.engine.handlers["chat/answer"](testCall(answer)));
    expect(expectOk(await read(test))).toStrictEqual({});
  });

  it("closes a question 24 hours old as it meets it, and tells every surface", async () => {
    const test = await startTestEngine();
    const view = await asked(test);
    await test.clock.advance(questionOpenMs);
    expect(expectOk(await read(test))).toStrictEqual({});
    expect(chatPushes(test, "chat/questionClosed")).toStrictEqual([
      { agent: testAgent, question: view.question, state: "closed", closeReason: "expired" },
    ]);
  });
});
