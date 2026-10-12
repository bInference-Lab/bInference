import { idSchema, type JsonValue } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { type QuestionRecord, questionOpenMs, questionViewOf } from "@binference/engine/chat";
import { createMemoryEngineStores, testAgent, testAgentDraft } from "@binference/engine/testing";
import { questionViewSchema } from "@binference/protocol";
import { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createFakeQuestionAnswers } from "../fakes/fake-question-answers.js";
import { createFakeBotApi, fakeBotToken } from "../testing/fake-bot-api.js";
import { ownerId, strangerId } from "../testing/update-fixtures.js";
import { type ButtonPress, chatUpdateSchema } from "../updates/chat-update.schema.js";
import { createTelegramQuestions } from "./create-telegram-questions.js";

const live = { signal: new AbortController().signal };
const ref = "q3Zr_x9-AbCdEfGh";
const choices = ["Take-profit at +50%", "Stop-loss at -20%", "Both, one after the other"];

const record: QuestionRecord = {
  id: idSchema("qst").parse("qst_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  agentId: testAgent,
  sessionId: idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  turnId: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  text: "Which exit should I set for PEPE first? <b>now</b>",
  choices,
  ref,
  state: "open",
  createdAtMs: 5_000,
  closesAtMs: 5_000 + questionOpenMs,
};

function pushOf(question: QuestionRecord): { readonly kind: string; readonly data: JsonValue } {
  const data = questionViewSchema.encode(questionViewOf(question)) as JsonValue;
  return { kind: "chat/question", data };
}

const closedPush = { kind: "chat/questionClosed", data: { question: record.id, state: "x" } };

async function setUp(locale: "en" | "zh" = "en") {
  const botApi = createFakeBotApi();
  const api = new Api(fakeBotToken, { fetch: botApi.fetch });
  const stores = createMemoryEngineStores();
  await stores.agents.create(testAgentDraft(), live);
  await stores.owners.bind({ userId: ownerId, pairedAtMs: 1 }, live);
  await stores.questions.ask(record, live);
  const answers = createFakeQuestionAnswers({ ownerId });
  answers.open(ref);
  const questions = createTelegramQuestions({
    api,
    owners: stores.owners,
    questions: stores.questions,
    answers,
    agentNames: async () => Promise.resolve(new Map([[testAgent, "main"]])),
    clock: createManualClock(6_000),
    logger: createMemoryLogger({ subsystem: "telegram" }),
    display: () => ({ locale, timeZone: "UTC" }),
  });
  return { botApi, stores, answers, questions };
}

function pressOf(update: JsonValue): ButtonPress {
  const parsed = chatUpdateSchema.parse(update);
  if (parsed.kind !== "callback") {
    throw new Error("The fixture is no button press.");
  }
  return parsed;
}

type Context = Awaited<ReturnType<typeof setUp>>;

async function press(context: Context, data: string, from = ownerId): Promise<boolean> {
  const update = context.botApi.press({ from, data, messageId: 1001 });
  return context.questions.press(pressOf(update), live);
}

// The engine's write of the answer, as `chat/answer` makes it.
async function answerInEngine(context: Context, choice: number): Promise<void> {
  const answer = { choice, surface: "telegram", atMs: 6_000 } as const;
  const message = {
    id: idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    turnId: idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000002"),
    opens: record.sessionId,
    payload: { text: choices[choice] ?? "", surface: "telegram" },
  };
  const stored = await context.stores.questions.answer(
    { questionId: record.id, answer, message },
    live,
  );
  expect(stored.ok).toBe(true);
}

describe("the agent's questions in Telegram", () => {
  it("shows the question escaped under its header, a button per choice, and keeps the copy", async () => {
    const context = await setUp();
    await context.questions.show(pushOf(record), live);
    expect(context.botApi.messages()).toMatchObject([
      {
        chatId: ownerId,
        text: "main asks\nWhich exit should I set for PEPE first? <b>now</b>\nOr write your own answer.",
        buttons: [
          [
            { text: "Take-profit at +50%", data: `bnf1:q:0:${ref}` },
            { text: "Stop-loss at -20%", data: `bnf1:q:1:${ref}` },
          ],
          [{ text: "Both, one after the other", data: `bnf1:q:2:${ref}` }],
        ],
      },
    ]);
    expect(await context.stores.questions.copies(record.id, live)).toStrictEqual([
      {
        questionId: record.id,
        surface: "telegram",
        chatId: ownerId,
        messageId: 1001,
        sentAtMs: 6_000,
      },
    ]);
  });

  it("sends the owner's first press to the engine once, and says a later one is closed", async () => {
    const context = await setUp();
    await context.questions.show(pushOf(record), live);
    expect(await press(context, `bnf1:q:1:${ref}`)).toBe(true);
    expect(await press(context, `bnf1:q:0:${ref}`)).toBe(true);
    expect(context.answers.answered()).toStrictEqual([{ ref, choice: 1, presserId: ownerId }]);
    expect(context.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      undefined,
      "This question is closed.",
    ]);
  });

  it("answers nothing to a press by anyone but the owner, and leaves other data alone", async () => {
    const context = await setUp();
    expect(await press(context, `bnf1:q:0:${ref}`, strangerId)).toBe(true);
    expect(await press(context, `bnf1:c:y:${ref}`)).toBe(false);
    expect(await press(context, `bnf1:q:7:${ref}`)).toBe(false);
    expect(context.answers.answered()).toStrictEqual([]);
    expect(context.botApi.answers()).toStrictEqual([]);
  });

  it("turns every copy into the answer once the question closes, without its buttons", async () => {
    const context = await setUp();
    await context.questions.show(pushOf(record), live);
    await answerInEngine(context, 1);
    await context.questions.show(closedPush, live);
    expect(context.botApi.messages()).toMatchObject([
      {
        text: "main asks\nWhich exit should I set for PEPE first? <b>now</b>\nAnswered: Stop-loss at -20%",
        buttons: [],
      },
    ]);
  });

  it("says why a question closed without an answer", async () => {
    const context = await setUp();
    await context.questions.show(pushOf(record), live);
    const closing = { questionId: record.id, reason: "cleared", atMs: 6_000 } as const;
    await context.stores.questions.close(closing, live);
    await context.questions.show(closedPush, live);
    expect(
      context.botApi.messages().map((message) => message.text.split("\n").at(-1)),
    ).toStrictEqual(["Closed: the chat was cleared"]);
  });
});
