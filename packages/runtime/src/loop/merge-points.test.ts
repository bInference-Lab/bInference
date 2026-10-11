import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import { createTestTurn, ownerMessage, type TestTool } from "./test-turns.js";

// A tool during whose run the owner writes again.
function writesDuring(name: string, options: Partial<TestTool> = {}) {
  return (recorder: TurnRecorder): TestTool => ({
    name,
    kind: "read",
    ...options,
    run: async () => {
      recorder.queue(ownerMessage(2, "wait, sell instead"));
      return { text: `ran ${name}`, isError: false };
    },
  });
}

function brief(step: RecordedStep): string {
  if (step.kind === "result") {
    return `result ${step.id}: ${step.text}`;
  }
  if (step.kind === "joined") {
    return `joined ${step.ids.join(",")}`;
  }
  return "id" in step ? `${step.kind} ${step.id}` : step.kind;
}

describe("merge points", () => {
  it("lets a message join before the next call of an ordered batch, which does not run", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [
        callsReply([{ name: "portfolio" }, { name: "alert_create" }]),
        textReply("Selling instead."),
      ],
      tools: (notes) => [
        writesDuring("portfolio")(notes),
        { name: "alert_create", kind: "control" },
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 2 });
    expect(recorder.steps.slice(2, 7).map(brief)).toStrictEqual([
      "call portfolio",
      "result portfolio: ran portfolio",
      "call alert_create",
      "result alert_create: not run: a new message came in",
      "joined msg_2",
    ]);
    expect(transport.requests[1]?.messages.slice(-3)).toStrictEqual([
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
        text: "not run: a new message came in",
        isError: true,
      },
      { role: "owner", text: "wait, sell instead" },
    ]);
  });

  it("never cuts a parallel batch: the message joins after it", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "quote" }, { name: "chart" }]), textReply("Selling instead.")],
      tools: (notes) => [
        writesDuring("quote", { parallel: true })(notes),
        { name: "chart", kind: "read", parallel: true },
      ],
    });
    await turn.run();
    expect(recorder.steps.slice(2, 7).map(brief)).toStrictEqual([
      "call quote",
      "call chart",
      "result quote: ran quote",
      "result chart: ran chart",
      "joined msg_2",
    ]);
  });

  it("lets a message join after a batch, before the next model call", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }]), textReply("Selling instead.")],
      tools: (notes) => [writesDuring("portfolio")(notes)],
    });
    await turn.run();
    expect(recorder.steps.slice(3, 6).map(brief)).toStrictEqual([
      "result portfolio: ran portfolio",
      "joined msg_2",
      "response",
    ]);
    expect(transport.requests[1]?.messages.at(-1)).toStrictEqual({
      role: "owner",
      text: "wait, sell instead",
    });
  });

  it("makes one more model call when a message waits as the model would end the turn", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [textReply("Bought."), textReply("And sold.")],
    });
    recorder.queue(ownerMessage(2, "now sell it"));
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 2 });
    expect(transport.requests[1]?.messages.slice(1)).toStrictEqual([
      { role: "agent", text: "Bought.", reasoning: "", toolCalls: [] },
      { role: "owner", text: "now sell it" },
    ]);
    expect(recorder.steps).toContainEqual({ kind: "say", text: "And sold." });
  });

  it("marks the turn when a joining message is outside content", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Bought."), textReply("Nice picture.")],
    });
    recorder.queue(ownerMessage(2, "see this chart", true));
    await turn.run();
    expect(recorder.steps.slice(2, 5).map(brief)).toStrictEqual([
      "joined msg_2",
      "engineMark",
      "journalMark",
    ]);
  });

  it("lets no message join a committed turn: it waits for the next turn", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply([{ name: "swap" }, { name: "portfolio" }], "Swapping.")],
      tools: (notes) => [
        writesDuring("swap", { kind: "propose" })(notes),
        { name: "portfolio", kind: "read" },
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(recorder.steps.some((step) => step.kind === "joined")).toBe(false);
    expect(recorder.steps).toContainEqual({
      kind: "result",
      id: "portfolio",
      text: "ran portfolio",
      ran: true,
      outside: false,
    });
    expect(transport.requests).toHaveLength(1);
    await expect(recorder.merge.take(new AbortController().signal)).resolves.toStrictEqual([
      ownerMessage(2, "wait, sell instead"),
    ]);
  });
});
