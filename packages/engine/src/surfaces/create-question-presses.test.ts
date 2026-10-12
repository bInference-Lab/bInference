import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import { createOwnerCalls } from "./create-owner-calls.js";
import { createQuestionPresses } from "./create-question-presses.js";

const live = { signal: new AbortController().signal };
const ownerId = 7_012_345_678;
const session = idSchema("ses").parse("ses_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const turn = idSchema("trn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const ownerOf = async (): Promise<number> => Promise.resolve(ownerId);

// An engine whose agent asked the owner a question in its running turn, and the presses on it.
async function askedEngine() {
  const test = await startTestEngine();
  const { handlers } = test.engine;
  const runtime = testCallers.runtime;
  const start = { agent: testAgent, session, turn, messages: [message], outsideContent: false };
  expectOk(await handlers["turn/start"](testCall(start, runtime)));
  const ask = { agent: testAgent, session, turn, text: "Sell PEPE?", choices: ["Yes", "No"] };
  const view = expectOk(await handlers["turn/ask"](testCall(ask, runtime)));
  const question = await test.stores.questions.get(view.question, live);
  const presses = createQuestionPresses({
    questions: test.stores.questions,
    calls: createOwnerCalls({ handlers, ownerId: ownerOf }),
    ownerId: ownerOf,
  });
  return { test, presses, ref: question?.ref ?? "" };
}

function answers(test: Awaited<ReturnType<typeof askedEngine>>["test"]) {
  return test.pushes.filter((push) => push.topic === "inbox").map((push) => push.data);
}

describe("the owner's presses of question buttons", () => {
  it("sends the first press to the agent once, as the owner's answer from Telegram", async () => {
    const { test, presses, ref } = await askedEngine();
    const press = { ref, choice: 1, presserId: ownerId };
    expect(await presses.answer(press, live)).toStrictEqual({ status: "answered" });
    expect(await presses.answer(press, live)).toStrictEqual({ status: "closed" });
    expect(await presses.answer({ ...press, choice: 0 }, live)).toStrictEqual({
      status: "closed",
    });
    expect(answers(test)).toStrictEqual([
      expect.objectContaining({ kind: "inbox/message", text: "No", surface: "telegram" }),
    ]);
  });

  it("does nothing for a press by anyone but the owner, or on a reference no question has", async () => {
    const { test, presses, ref } = await askedEngine();
    const stranger = { ref, choice: 0, presserId: ownerId + 1 };
    expect(await presses.answer(stranger, live)).toStrictEqual({ status: "unknown" });
    const forged = { ref: "ZZZZZZZZZZZZZZZZ", choice: 0, presserId: ownerId };
    expect(await presses.answer(forged, live)).toStrictEqual({ status: "unknown" });
    expect(answers(test)).toStrictEqual([]);
    const press = { ref, choice: 0, presserId: ownerId };
    expect(await presses.answer(press, live)).toStrictEqual({ status: "answered" });
  });
});
