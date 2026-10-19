import { describe, expect, it } from "vitest";
import { questionPushOf } from "./question-push.schema.js";

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const question = "qst_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const view = {
  question,
  agent,
  session: "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  text: "Hours or days?",
  choices: ["Hours", "Days"],
  state: "open",
  createdAt: 1,
  closesAt: 86_400_001,
};

describe("questionPushOf", () => {
  it("reads a question and how it closed", () => {
    expect(questionPushOf({ kind: "chat/question", data: view })).toStrictEqual({
      kind: "chat/question",
      view,
    });
    const closed = {
      agent,
      question,
      state: "answered",
      answer: { choice: 1, surface: "console", at: 2 },
    };
    expect(questionPushOf({ kind: "chat/questionClosed", data: closed })).toStrictEqual({
      kind: "chat/questionClosed",
      question,
      state: "answered",
      answer: { choice: 1, surface: "console", at: 2 },
    });
  });

  it.each([
    ["another push", { kind: "chat/message", data: view }],
    ["a question it cannot read", { kind: "chat/question", data: { ...view, choices: "Hours" } }],
    ["a close with no state", { kind: "chat/questionClosed", data: { agent, question } }],
  ] as const)(
    "leaves %s alone",
    (_case: string, push: { readonly kind: string; readonly data: unknown }) => {
      expect(questionPushOf(push)).toBeUndefined();
    },
  );
});
