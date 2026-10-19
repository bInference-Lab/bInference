import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createTestTurn } from "../loop/test-turns.js";
import {
  agent,
  callTool,
  context,
  intentWire,
  outcomeOf,
  swapTerms,
  toolTurn,
} from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import { agentToolBox } from "./agent-tools.js";
import { askedText } from "./ask-owner-tool.js";

const refusedText =
  "not asked: the engine refused the question, as this turn is no longer running. Nothing reached the owner.";

const question = {
  text: "Which exit should I set for PEPE first?",
  choices: ["Take-profit at +50%", "Stop-loss at -20%"],
};

const asked: FakeAnswer = {
  question: "qst_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
  agent,
  ...toolTurn,
  ...question,
  state: "open",
  createdAt: 1,
  closesAt: 86_400_001,
};

const answers: Readonly<Record<string, FakeAnswer>> = {
  "turn/ask": asked,
  "portfolio/get": { balances: [], positions: [], totalUsdMicros: "0", assets: {} },
  "intent/propose": intentWire("awaiting_confirmation"),
};

function turnOf(
  calls: Parameters<typeof callsReply>[0],
  engine: Readonly<Record<string, FakeAnswer>> = answers,
) {
  const client = createFakeToolClient(engine);
  const test = createTestTurn({
    box: agentToolBox({ agent, client, turn: toolTurn }),
    replies: [callsReply(calls, "Which one?"), textReply("Asked again.")],
  });
  return { ...test, client };
}

describe("ask_owner", () => {
  it("asks in the turn it serves, with the call's key, and ends the turn", async () => {
    const run = callTool(answers, { name: "ask_owner", args: question });
    await expect(outcomeOf(run)).resolves.toStrictEqual({
      text: askedText,
      isError: false,
      endsTurn: true,
    });
    expect(run.client.calls()).toStrictEqual([
      { op: "turn/ask", args: { agent, ...toolTurn, ...question }, key: context.idempotencyKey },
    ]);
  });

  it("ends the turn after its batch with no other model call, the batch's read run", async () => {
    const { turn, transport, client } = turnOf([
      { id: "q", name: "ask_owner", args: question },
      { id: "p", name: "portfolio", args: {} },
    ]);
    await expect(turn.run()).resolves.toMatchObject({
      state: "ended",
      outcome: "ok",
      committed: false,
      modelCalls: 1,
    });
    expect(transport.requests).toHaveLength(1);
    expect(client.calls().map(({ op }) => op)).toStrictEqual(["turn/ask", "portfolio/get"]);
  });

  it("gives way to a proposal in its batch, whose card already asks the owner", async () => {
    const { turn, client } = turnOf([
      { id: "s", name: "swap", args: swapTerms },
      { id: "q", name: "ask_owner", args: question },
    ]);
    await expect(turn.run()).resolves.toMatchObject({ committed: true, modelCalls: 1 });
    expect(client.calls().map(({ op }) => op)).toStrictEqual(["intent/propose"]);
  });

  it("lets the turn go on when the engine refused the question", async () => {
    const refused = new BinferenceError({ code: "protocol.bad_args", message: "Not running." });
    const { turn, recorder } = turnOf([{ id: "q", name: "ask_owner", args: question }], {
      ...answers,
      "turn/ask": refused,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 2 });
    const results = recorder.steps.filter((step) => step.kind === "result");
    expect(results).toMatchObject([{ id: "q", text: refusedText }]);
  });

  it.each([
    ["one choice", { ...question, choices: ["Yes"] }],
    ["five choices", { ...question, choices: ["A", "B", "C", "D", "E"] }],
    ["the same choice twice", { ...question, choices: ["Yes", "Yes"] }],
    ["a choice over two lines", { ...question, choices: ["Yes\nnow", "No"] }],
    ["a choice that opens with a card's icon", { ...question, choices: ["\u{2705} Yes", "No"] }],
    ["a choice over 64 characters", { ...question, choices: ["x".repeat(65), "No"] }],
    ["a question over 500 characters", { ...question, text: "x".repeat(501) }],
  ])("refuses %s before the engine hears of it", (_case, args) => {
    const run = callTool(answers, { name: "ask_owner", args });
    expect(run.refused).toMatch(/^not run: the arguments do not match ask_owner's schema/);
    expect(run.client.calls()).toStrictEqual([]);
  });
});
