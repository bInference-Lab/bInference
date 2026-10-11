import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import type { ChatTurn } from "./chat-turn.js";
import type { OwnerMessage } from "./model-message.js";
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

const signal = new AbortController().signal;

interface StopHolder {
  turn?: ChatTurn;
  queue?: (message: OwnerMessage) => void;
}

// The owner stops the turn while its response is written, then writes again.
function stopAtResponse(holder: StopHolder): (step: RecordedStep) => void {
  return (step) => {
    if (step.kind === "response") {
      holder.turn?.stop("owner");
      holder.queue?.(ownerMessage(2, "after the stop"));
    }
  };
}

describe("a merge point where no model call can follow", () => {
  it("leaves a message typed while the agent asks the owner in the queue, to start the next turn", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "ask_owner" }, { name: "portfolio" }], "Which one?")],
      tools: (notes) => [
        {
          name: "ask_owner",
          kind: "control",
          run: async () => {
            notes.queue(ownerMessage(2, "the second one"));
            return { text: "asked", isError: false, endsTurn: true };
          },
        },
        { name: "portfolio", kind: "read" },
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 1 });
    expect(recorder.steps.some((step) => step.kind === "joined")).toBe(false);
    expect(recorder.steps).toContainEqual({
      kind: "result",
      id: "portfolio",
      text: "ran portfolio",
      ran: true,
      outside: false,
    });
    await expect(recorder.merge.take(signal)).resolves.toStrictEqual([
      ownerMessage(2, "the second one"),
    ]);
  });

  it("leaves a message in the queue in a batch that goes past the tool call limit", async () => {
    const calls = [
      { id: "r0", name: "first" },
      ...Array.from({ length: 25 }, (_unused, index) => ({
        id: `r${String(index + 1)}`,
        name: "portfolio",
      })),
    ];
    const { turn, recorder } = createTestTurn({
      replies: [callsReply(calls)],
      tools: (notes) => [writesDuring("first")(notes), { name: "portfolio", kind: "read" }],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "loop" });
    expect(recorder.steps.some((step) => step.kind === "joined")).toBe(false);
    await expect(recorder.merge.take(signal)).resolves.toHaveLength(1);
  });

  it("leaves a message in the queue after the batch of the last model call", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }])],
      tools: (notes) => [writesDuring("portfolio")(notes)],
      limits: { maxModelCalls: 1 },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "loop", modelCalls: 1 });
    await expect(recorder.merge.take(signal)).resolves.toHaveLength(1);
  });

  it("leaves a message in the queue when the last model call answers", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Done.")],
      limits: { maxModelCalls: 1 },
    });
    recorder.queue(ownerMessage(2, "and then?"));
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 1 });
    await expect(recorder.merge.take(signal)).resolves.toHaveLength(1);
  });

  it("leaves a message that came after a stop in the queue", async () => {
    const holder: StopHolder = {};
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Done.")],
      recorder: { beforeStep: stopAtResponse(holder) },
    });
    holder.turn = turn;
    holder.queue = (message) => recorder.queue(message);
    await expect(turn.run()).resolves.toMatchObject({ outcome: "stopped" });
    await expect(recorder.merge.take(signal)).resolves.toHaveLength(1);
  });
});
