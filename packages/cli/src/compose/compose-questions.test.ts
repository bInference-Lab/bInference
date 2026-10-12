import { idSchema } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent as agent } from "@binference/engine/testing";
import { questionAnswersContract } from "@binference/telegram/testing";
import { describe, expect, it } from "vitest";
import { type Bot, bot, never, ownerId } from "./test-bot.js";

const live = { signal: new AbortController().signal };
const strangerId = ownerId + 1;
const runtimeToken = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000021");
const runtime: EngineCaller = {
  credential: runtimeToken,
  client: { kind: "runtime", version: "test" },
  scopes: ["read", "propose", "agent"],
};
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");

// A bot whose agent asked the owner a question in its running turn, and the question's reference.
async function asked(): Promise<{ readonly test: Bot; readonly ref: string }> {
  const turns = createRunningTurns();
  const test = await bot({ turns });
  turns.startRuntime(runtimeToken);
  const { handlers } = test.composed.engine;
  const start = { agent, session, turn, messages: [message], outsideContent: false };
  await handlers["turn/start"]({ args: start, caller: runtime, ...live });
  const ask = { agent, session, turn, text: "Sell PEPE now?", choices: ["Yes", "Not yet"] };
  const view = await handlers["turn/ask"]({ args: ask, caller: runtime, ...live });
  const id = view.ok ? view.value.question : never();
  const question = await test.parts.stores.questions.get(id, live);
  // The turn ends after its question, as the runtime ends it; its status message goes.
  const end = { agent, turn, outcome: "ok" } as const;
  await handlers["turn/end"]({ args: end, caller: runtime, ...live });
  await test.telegram.idle();
  return { test, ref: question?.ref ?? never() };
}

// The answers waiting in the agent's inbox for the runtime.
async function answersHeard(test: Bot): Promise<readonly unknown[]> {
  const { handlers } = test.composed.engine;
  const listed = await handlers["inbox/list"]({ args: { agent }, caller: runtime, ...live });
  const items = listed.ok ? listed.value.items : never();
  return items.filter((item) => item.kind === "inbox/message" && item.answer !== undefined);
}

async function pressAs(test: Bot, from: number, data: string): Promise<void> {
  await test.telegram.ingress.receive(test.botApi.press({ from, data, messageId: 1001 }), live);
  await test.telegram.idle();
}

describe("the agent's questions on the bot joined to the engine", () => {
  it.each(
    questionAnswersContract({
      create: async () => {
        const { test, ref } = await asked();
        const heard = async () => (await answersHeard(test)).length;
        return { answers: test.telegram.questionAnswers, ref, ownerId, heard };
      },
    }),
  )("answers presses as the question answers contract says: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("shows the question with its buttons, and sends the owner's first press to the agent once", async () => {
    const { test, ref } = await asked();
    expect(test.botApi.messages()).toMatchObject([
      {
        chatId: ownerId,
        text: "main asks\nSell PEPE now?\nOr write your own answer.",
        buttons: [[{ data: `bnf1:q:0:${ref}` }, { data: `bnf1:q:1:${ref}` }]],
      },
    ]);
    await pressAs(test, ownerId, `bnf1:q:1:${ref}`);
    await pressAs(test, ownerId, `bnf1:q:0:${ref}`);
    expect(await answersHeard(test)).toMatchObject([
      { text: "Not yet", surface: "telegram", answer: { choice: 1 } },
    ]);
    expect(test.botApi.messages()).toMatchObject([
      { text: "main asks\nSell PEPE now?\nAnswered: Not yet", buttons: [] },
    ]);
    expect(test.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      undefined,
      "This question is closed.",
    ]);
  });

  it("does nothing for a press by anyone but the owner", async () => {
    const { test, ref } = await asked();
    await pressAs(test, strangerId, `bnf1:q:0:${ref}`);
    expect(await answersHeard(test)).toStrictEqual([]);
    expect(test.botApi.answers()).toStrictEqual([]);
    expect(test.botApi.messages()).toMatchObject([{ buttons: [[{}, {}]] }]);
  });
});
