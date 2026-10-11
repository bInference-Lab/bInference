import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import type { ModelEvent } from "./model-event.js";
import { createTestTurn, ownerMessage, type TestTool } from "./test-turns.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const portfolio: TestTool = { name: "portfolio", kind: "read" };
const alert: TestTool = { name: "alert_create", kind: "control" };

describe("createChatTurn", () => {
  it("starts the turn, answers with text, then writes its end after the final text", async () => {
    const { turn, recorder, transport } = createTestTurn({ replies: [textReply("Hi.")] });
    await expect(turn.run()).resolves.toStrictEqual({
      state: "ended",
      outcome: "ok",
      committed: false,
      heldBack: 0,
      toolCalls: 0,
      modelCalls: 1,
    });
    expect(recorder.steps).toStrictEqual([
      { kind: "start", messages: ["msg_1"], outside: false },
      { kind: "response", text: "Hi." },
      { kind: "say", text: "Hi." },
      { kind: "journalEnd", outcome: "ok", heldBack: 0 },
      { kind: "end", outcome: "ok" },
    ]);
    expect(transport.requests[0]?.messages).toStrictEqual([{ role: "owner", text: "hello" }]);
    expect(turn.state).toBe("ended");
  });

  it("sends the history, then the messages the turn takes, with the tools' declarations", async () => {
    const { turn, transport } = createTestTurn({
      replies: [textReply("Hi.")],
      tools: [portfolio],
      history: [{ role: "owner", text: "earlier" }],
      taken: [ownerMessage(1, "one"), ownerMessage(2, "two")],
    });
    await turn.run();
    expect(transport.requests[0]).toStrictEqual({
      instructions: "You are a test agent.",
      messages: [
        { role: "owner", text: "earlier" },
        { role: "owner", text: "one" },
        { role: "owner", text: "two" },
      ],
      tools: [{ name: "portfolio", description: "portfolio", parameters: {} }],
    });
  });

  it("runs a response's calls, then calls the model again with each result after its call", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [
        callsReply([{ name: "portfolio" }, { name: "alert_create", args: { above: "1" } }], "Hm."),
        textReply("Done."),
      ],
      tools: [portfolio, alert],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", toolCalls: 2, modelCalls: 2 });
    expect(recorder.steps.slice(1, 7)).toStrictEqual([
      { kind: "response", text: "Hm." },
      { kind: "call", id: "portfolio", name: "portfolio" },
      { kind: "result", id: "portfolio", text: "ran portfolio", ran: true, outside: false },
      { kind: "call", id: "alert_create", name: "alert_create" },
      { kind: "result", id: "alert_create", text: "ran alert_create", ran: true, outside: false },
      { kind: "response", text: "Done." },
    ]);
    expect(transport.requests[1]?.messages.slice(1)).toStrictEqual([
      {
        role: "agent",
        text: "Hm.",
        reasoning: "",
        toolCalls: [
          { id: "portfolio", name: "portfolio", argumentsText: "{}" },
          { id: "alert_create", name: "alert_create", argumentsText: '{"above":"1"}' },
        ],
      },
      {
        role: "tool",
        callId: "portfolio",
        name: "portfolio",
        text: "ran portfolio",
        isError: false,
      },
      {
        role: "tool",
        callId: "alert_create",
        name: "alert_create",
        text: "ran alert_create",
        isError: false,
      },
    ]);
  });

  it("refuses to start when the engine refuses, and calls no model", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [textReply("Hi.")],
      recorder: { refuse: "budget" },
    });
    await expect(turn.run()).resolves.toStrictEqual({ state: "refused", refusal: "budget" });
    expect(transport.requests).toHaveLength(0);
    expect(recorder.steps.map((step) => step.kind)).toStrictEqual(["start"]);
    expect(turn.state).toBe("refused");
  });

  it("runs once however often it is asked", async () => {
    const { turn, recorder } = createTestTurn({ replies: [textReply("Hi.")] });
    const [first, second] = await Promise.all([turn.run(), turn.run()]);
    expect(first).toBe(second);
    expect(recorder.steps.filter((step) => step.kind === "start")).toHaveLength(1);
  });

  it("ends failed when the model call fails, naming the failure in its status line", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [[{ type: "error", failure: "auth", message: "401" }]],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed" });
    expect(recorder.steps.slice(1)).toStrictEqual([
      { kind: "status", line: { line: "failed", failure: "auth" } },
      { kind: "journalEnd", outcome: "failed", heldBack: 0 },
      { kind: "end", outcome: "failed" },
    ]);
  });

  it("ends ok with what the model wrote when the provider refused for its own rules", async () => {
    const refused: ModelEvent[] = [
      { type: "text", delta: "I can not" },
      { type: "error", failure: "refused", message: "safety" },
    ];
    const { turn, recorder } = createTestTurn({ replies: [refused] });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(recorder.steps).toContainEqual({ kind: "say", text: "I can not" });
  });

  it("answers each call of a response cut off at its output limit as not run, and goes on", async () => {
    const cut: ModelEvent[] = [
      { type: "toolCallStart", index: 0, id: "c1", name: "portfolio" },
      { type: "toolCallDelta", index: 0, delta: '{"wal' },
      { type: "done", stop: "length", usage },
    ];
    const { turn, recorder, transport } = createTestTurn({
      replies: [cut, textReply("Shorter now.")],
      tools: [portfolio],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", toolCalls: 1 });
    expect(recorder.steps).toContainEqual({
      kind: "result",
      id: "c1",
      text: "not run: the response reached its output limit before this call was complete",
      ran: false,
      outside: false,
    });
    expect(transport.requests).toHaveLength(2);
  });

  it("ends loop at the model call limit", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }]), callsReply([{ name: "portfolio" }])],
      tools: [portfolio],
      limits: { maxModelCalls: 2 },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "loop", modelCalls: 2 });
    expect(transport.requests).toHaveLength(2);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "modelCallLimit" } });
  });

  it("ends after the batch in which a tool asked the owner a question", async () => {
    const ask: TestTool = {
      name: "ask_owner",
      kind: "control",
      run: async () => ({ text: "asked", isError: false, endsTurn: true }),
    };
    const { turn, transport } = createTestTurn({
      replies: [callsReply([{ name: "ask_owner" }, { name: "portfolio" }], "Which one?")],
      tools: [ask, portfolio],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", toolCalls: 2, modelCalls: 1 });
    expect(transport.requests).toHaveLength(1);
  });

  it("gives a tool that throws an error result and goes on", async () => {
    const broken: TestTool = {
      name: "portfolio",
      kind: "read",
      run: async () => {
        throw new Error("boom");
      },
    };
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }]), textReply("Sorry.")],
      tools: [broken],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 2 });
    expect(recorder.steps).toContainEqual({
      kind: "result",
      id: "portfolio",
      text: "failed: the tool stopped with an error",
      ran: true,
      outside: false,
    });
  });

  it("gives a read with no answer within 60 seconds its timeout as its result", async () => {
    const silent: TestTool = {
      name: "portfolio",
      kind: "read",
      run: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }]), textReply("Slow today.")],
      tools: [silent],
    });
    const report = turn.run();
    await clock.advance(59_999);
    expect(recorder.steps.some((step) => step.kind === "result")).toBe(false);
    await clock.advance(1);
    await expect(report).resolves.toMatchObject({ outcome: "ok", modelCalls: 2 });
    expect(recorder.steps).toContainEqual({
      kind: "result",
      id: "portfolio",
      text: "failed: no answer within 60 seconds",
      ran: true,
      outside: false,
    });
  });
});

function resultTexts(steps: readonly RecordedStep[]): readonly string[] {
  return steps.flatMap((step) => (step.kind === "result" ? [step.text] : []));
}

function cutOffCalls(count: number): ModelEvent[] {
  const calls = Array.from({ length: count }, (_unused, index): ModelEvent[] => [
    { type: "toolCallStart", index, id: `cut${String(index)}`, name: "portfolio" },
    { type: "toolCallDelta", index, delta: '{"wal' },
  ]);
  return [...calls.flat(), { type: "done", stop: "length", usage }];
}

describe("a response cut off at its output limit", () => {
  it("sends its calls back with empty arguments, never their half-written text", async () => {
    const { turn, transport } = createTestTurn({
      replies: [cutOffCalls(1), textReply("Shorter now.")],
      tools: [portfolio],
    });
    await turn.run();
    expect(transport.requests[1]?.messages[1]).toStrictEqual({
      role: "agent",
      text: "",
      reasoning: "",
      toolCalls: [{ id: "cut0", name: "portfolio", argumentsText: "{}" }],
    });
  });

  it("ends the turn loop when its calls go past the 25th, which get the limit's result", async () => {
    const reads = Array.from({ length: 24 }, (_unused, index) => ({
      id: `r${String(index)}`,
      name: "portfolio",
    }));
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply(reads), cutOffCalls(3), textReply("never")],
      tools: [portfolio],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "loop", toolCalls: 27 });
    expect(resultTexts(recorder.steps).slice(24)).toStrictEqual([
      "not run: the response reached its output limit before this call was complete",
      "not run: the turn reached its tool call limit",
      "not run: the turn reached its tool call limit",
    ]);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "toolCallLimit" } });
    expect(transport.requests).toHaveLength(2);
  });
});

// A model that answers with text and, each time, finds the owner has written again.
function whileOwnerWrites(
  holder: { recorder?: TurnRecorder },
  replies: readonly (readonly ModelEvent[])[],
) {
  return replies.map((events, index) => (): AsyncGenerator<ModelEvent> => {
    holder.recorder?.queue(ownerMessage(index + 2, "and another thing"));
    return replay(events);
  });
}

async function* replay(events: readonly ModelEvent[]): AsyncGenerator<ModelEvent> {
  yield* events;
}

describe("the model call limit", () => {
  it("ends the turn loop at its 40th model call, the waiting message left for the next turn", async () => {
    const holder: { recorder?: TurnRecorder } = {};
    const { turn, recorder, transport } = createTestTurn({
      replies: whileOwnerWrites(holder, [
        ...Array.from({ length: 39 }, (_unused, index) =>
          textReply(`Answer ${String(index + 1)}.`),
        ),
        callsReply([{ name: "portfolio" }]),
        textReply("never"),
      ]),
      tools: [portfolio],
    });
    holder.recorder = recorder;
    await expect(turn.run()).resolves.toMatchObject({ outcome: "loop", modelCalls: 40 });
    expect(transport.requests).toHaveLength(40);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "modelCallLimit" } });
    await expect(recorder.merge.take(new AbortController().signal)).resolves.toHaveLength(1);
  });
});
