import { describe, expect, it } from "vitest";
import { callsReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import type { ModelEvent } from "./model-event.js";
import { createTestTurn, type TestTool } from "./test-turns.js";

// Runtime spec, section 5.4 and invariant 5: a proposal from a turn whose context holds outside
// content carries the mark. The engine gives a proposal of the runtime the mark of its agent's
// running turn as it stands when the proposal arrives, and its auto test refuses a marked one, so
// the turn's mark must reach the engine before the proposal does.

const notes: { recorder?: TurnRecorder } = {};

async function* modelCall(events: readonly ModelEvent[]): AsyncGenerator<ModelEvent> {
  notes.recorder?.note({ kind: "tool", name: "model call", key: "" });
  yield* events;
}

function swap(recorder: TurnRecorder): TestTool {
  return {
    name: "swap",
    kind: "propose",
    run: async ({ idempotencyKey }) => {
      recorder.note({ kind: "tool", name: "swap sent", key: idempotencyKey });
      return { text: "int_1 waits for the owner's confirmation", isError: false };
    },
  };
}

const searchWeb: TestTool = { name: "search_web", kind: "read", outside: true };

function order(steps: readonly RecordedStep[]): readonly string[] {
  return steps.flatMap((step) => {
    if (step.kind === "tool") {
      return [step.name];
    }
    return step.kind === "engineMark" || step.kind === "proposal" ? [step.kind] : [];
  });
}

function startOf(steps: readonly RecordedStep[]): RecordedStep | undefined {
  return steps.find((step) => step.kind === "start");
}

describe("the outside-content mark", () => {
  it("reaches the engine before the next model call and before the turn's proposal", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        () => modelCall(callsReply([{ name: "search_web" }])),
        () => modelCall(callsReply([{ name: "swap" }])),
      ],
      tools: (journal) => [searchWeb, swap(journal)],
    });
    notes.recorder = recorder;
    await expect(turn.run()).resolves.toMatchObject({ committed: true });
    expect(order(recorder.steps)).toStrictEqual([
      "model call",
      "engineMark",
      "model call",
      "proposal",
      "swap sent",
    ]);
  });

  it("reaches the engine before a proposal later in the same batch", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [() => modelCall(callsReply([{ name: "search_web" }, { name: "swap" }]))],
      tools: (journal) => [searchWeb, swap(journal)],
    });
    notes.recorder = recorder;
    await turn.run();
    expect(order(recorder.steps)).toStrictEqual([
      "model call",
      "engineMark",
      "proposal",
      "swap sent",
    ]);
  });

  it("starts a turn whose history holds outside content marked, so its proposal carries the mark", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "swap" }])],
      tools: (journal) => [swap(journal)],
      outsideContent: true,
    });
    await turn.run();
    expect(startOf(recorder.steps)).toStrictEqual({
      kind: "start",
      messages: ["msg_1"],
      outside: true,
    });
    expect(order(recorder.steps)).toStrictEqual(["proposal", "swap sent"]);
  });

  it("leaves a turn that saw no outside content unmarked", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }, { name: "swap" }])],
      tools: (journal) => [{ name: "portfolio", kind: "read" }, swap(journal)],
    });
    await turn.run();
    expect(startOf(recorder.steps)).toStrictEqual({
      kind: "start",
      messages: ["msg_1"],
      outside: false,
    });
    expect(recorder.steps.some((step) => step.kind === "engineMark")).toBe(false);
  });
});
