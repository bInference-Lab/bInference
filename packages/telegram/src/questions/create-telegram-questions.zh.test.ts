import { idSchema, type JsonValue } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { type QuestionRecord, questionOpenMs, questionViewOf } from "@binference/engine/chat";
import { createMemoryEngineStores, testAgent, testAgentDraft } from "@binference/engine/testing";
import { questionViewSchema } from "@binference/protocol";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeQuestionAnswers } from "../fakes/fake-question-answers.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId } from "../testing/update-fixtures.js";
import { type ButtonPress, chatUpdateSchema } from "../updates/chat-update.schema.js";
import { createTelegramQuestions } from "./create-telegram-questions.js";

const live = { signal: new AbortController().signal };
const ref = "q3Zr_x9-AbCdEfGh";
const record: QuestionRecord = {
  id: idSchema("qst").parse("qst_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  agentId: testAgent,
  sessionId: idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  turnId: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  text: "PEPE 先设置哪种平仓方式？",
  choices: ["+50% 止盈", "-20% 止损"],
  ref,
  state: "open",
  createdAtMs: 5_000,
  closesAtMs: 5_000 + questionOpenMs,
};

async function setUp() {
  const botApi = createFakeBotApi();
  const stores = createMemoryEngineStores();
  await stores.agents.create(testAgentDraft(), live);
  await stores.owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  await stores.questions.ask(record, live);
  const answers = createFakeQuestionAnswers({ ownerId });
  const questions = createTelegramQuestions({
    api: new Api(fakeBotToken, { fetch: botApi.fetch }),
    owners: stores.owners,
    questions: stores.questions,
    answers,
    agentNames: async () => Promise.resolve(new Map([[testAgent, "main"]])),
    clock: createManualClock(6_000),
    logger: createMemoryLogger({ subsystem: "telegram" }),
    display: () => ({ locale: "zh", timeZone: "UTC" }),
  });
  return { botApi, stores, answers, questions };
}

describe("the agent's questions in Telegram, in Chinese", () => {
  it("names the agent that asks and offers a written answer", async () => {
    const context = await setUp();
    const data = questionViewSchema.encode(questionViewOf(record)) as JsonValue;
    await context.questions.show({ kind: "chat/question", data }, live);
    expect(context.botApi.messages().map((message) => message.text)).toStrictEqual([
      "main 想问你\nPEPE 先设置哪种平仓方式？\n也可以直接输入你的回答。",
    ]);
  });

  it("says in Chinese that a pressed question is closed, and why it closed", async () => {
    const context = await setUp();
    const data = questionViewSchema.encode(questionViewOf(record)) as JsonValue;
    await context.questions.show({ kind: "chat/question", data }, live);
    context.answers.open(ref);
    context.answers.close(ref);
    const update = chatUpdateSchema.parse(
      context.botApi.press({ from: ownerId, data: `bnf1:q:0:${ref}`, messageId: 1001 }),
    );
    expect(update.kind).toBe("callback");
    await context.questions.press(update as ButtonPress, live);
    expect(context.botApi.answers().map((answer) => answer.text)).toStrictEqual(["此问题已关闭。"]);
    const newer = {
      ...record,
      id: idSchema("qst").parse("qst_0190f1c2-3a4b-7c5d-8e6f-000000000002"),
      ref: "Zz9_Yy8-XxWwVvUu",
      createdAtMs: 6_000,
    };
    await context.stores.questions.ask(newer, live);
    await context.questions.show(
      { kind: "chat/questionClosed", data: { question: record.id } },
      live,
    );
    expect(
      context.botApi.messages().map((message) => message.text.split("\n").at(-1)),
    ).toStrictEqual(["已关闭：main 提出了新问题"]);
  });
});
