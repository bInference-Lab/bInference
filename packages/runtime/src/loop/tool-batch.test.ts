import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { TurnRecorder } from "../testing/turn-recorder.js";
import { createTestTurn, ownerMessage, type TestTool } from "./test-turns.js";

// A tool that notes when its body starts and ends, a few turns of the event loop apart.
function traced(
  name: string,
  options: Partial<TestTool> = {},
): (recorder: TurnRecorder) => TestTool {
  return (recorder) => ({
    name,
    kind: "read",
    ...options,
    run: async () => {
      recorder.note({ kind: "tool", name: `${name} start`, key: "" });
      await Promise.resolve();
      await Promise.resolve();
      recorder.note({ kind: "tool", name: `${name} end`, key: "" });
      return { text: `ran ${name}`, isError: false };
    },
  });
}

function toolSteps(recorder: TurnRecorder): readonly string[] {
  return recorder.steps.flatMap((step) => (step.kind === "tool" ? [step.name] : []));
}

function resultIds(recorder: TurnRecorder): readonly string[] {
  return recorder.steps.flatMap((step) => (step.kind === "result" ? [step.id] : []));
}

function results(recorder: TurnRecorder): readonly (readonly [string, string, boolean])[] {
  return recorder.steps.flatMap((step) =>
    step.kind === "result" ? [[step.id, step.text, step.ran] as const] : [],
  );
}

function callsAndTools(recorder: TurnRecorder): readonly string[] {
  return recorder.steps.flatMap((step) => {
    if (step.kind === "call") {
      return [`call ${step.id}`];
    }
    return step.kind === "tool" ? ["tool"] : [];
  });
}

function traceTurn(names: readonly [string, Partial<TestTool>][]) {
  return createTestTurn({
    replies: [callsReply(names.map(([name]) => ({ name }))), textReply("Done.")],
    tools: (recorder) => names.map(([name, options]) => traced(name, options)(recorder)),
  });
}

describe("runToolBatch", () => {
  it("runs reads that allow it side by side, and writes their results in the model's order", async () => {
    const { turn, recorder } = traceTurn([
      ["quote", { parallel: true }],
      ["chart", { parallel: true }],
    ]);
    await turn.run();
    expect(toolSteps(recorder)).toStrictEqual([
      "quote start",
      "chart start",
      "quote end",
      "chart end",
    ]);
    expect(callsAndTools(recorder)).toStrictEqual([
      "call quote",
      "call chart",
      "tool",
      "tool",
      "tool",
      "tool",
    ]);
    expect(resultIds(recorder)).toStrictEqual(["quote", "chart"]);
  });

  it.each([
    [
      "a read that does not allow it",
      [
        ["quote", { parallel: true }],
        ["portfolio", {}],
      ],
    ],
    [
      "a control call",
      [
        ["quote", { parallel: true }],
        ["alert_create", { kind: "control" }],
      ],
    ],
    [
      "a propose call",
      [
        ["quote", { parallel: true }],
        ["swap", { kind: "propose" }],
      ],
    ],
  ] satisfies [string, [string, Partial<TestTool>][]][])(
    "runs a batch with %s one call at a time",
    async (_case, names) => {
      const { turn, recorder } = traceTurn(names);
      await turn.run();
      const [first, second] = names.map(([name]) => name);
      expect(toolSteps(recorder)).toStrictEqual([
        `${String(first)} start`,
        `${String(first)} end`,
        `${String(second)} start`,
        `${String(second)} end`,
      ]);
    },
  );

  it("answers a call to an unknown tool or with bad arguments with its refusal, never running it", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [
        callsReply([
          { id: "c1", name: "nope" },
          { id: "c2", name: "portfolio", args: "{not json" },
          { id: "c3", name: "portfolio" },
        ]),
        textReply("Fixed."),
      ],
      tools: [{ name: "portfolio", kind: "read" }],
    });
    await expect(turn.run()).resolves.toMatchObject({
      outcome: "ok",
      toolCalls: 3,
      committed: false,
    });
    expect(results(recorder)).toStrictEqual([
      ["c1", "refused nope", false],
      ["c2", "refused portfolio", false],
      ["c3", "ran portfolio", true],
    ]);
    expect(
      transport.requests[1]?.messages.filter((message) => message.role === "tool"),
    ).toHaveLength(3);
  });

  it("keeps a refused call apart from a parallel batch, which still runs side by side", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ name: "quote" }, { name: "nope" }, { name: "chart" }]),
        textReply("Done."),
      ],
      tools: (notes) => [
        traced("quote", { parallel: true })(notes),
        traced("chart", { parallel: true })(notes),
      ],
    });
    await turn.run();
    expect(toolSteps(recorder)).toStrictEqual([
      "quote start",
      "chart start",
      "quote end",
      "chart end",
    ]);
    expect(resultIds(recorder)).toStrictEqual(["quote", "nope", "chart"]);
  });

  it("marks the turn in the engine as soon as a result holds outside content, before the next call", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ name: "search_web" }, { name: "alert_create" }]),
        textReply("Found."),
      ],
      tools: [
        { name: "search_web", kind: "read", outside: true },
        { name: "alert_create", kind: "control" },
      ],
    });
    await turn.run();
    expect(recorder.steps.slice(2, 8).map((step) => step.kind)).toStrictEqual([
      "call",
      "result",
      "engineMark",
      "journalMark",
      "call",
      "result",
    ]);
    expect(recorder.steps).toContainEqual({
      kind: "result",
      id: "search_web",
      text: "ran search_web",
      ran: true,
      outside: true,
    });
  });

  it("marks the turn once, when a tool's own result says it holds outside content", async () => {
    const notes: TestTool = {
      name: "notes_search",
      kind: "read",
      run: async () => ({ text: "an untrusted note", isError: false, outside: true }),
    };
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([
          { id: "a", name: "notes_search" },
          { id: "b", name: "notes_search" },
        ]),
        textReply("Ok."),
      ],
      tools: [notes],
    });
    await turn.run();
    expect(recorder.steps.filter((step) => step.kind === "engineMark")).toHaveLength(1);
  });

  it("starts a turn marked when a message it takes is outside content, and marks nothing again", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "search_web" }]), textReply("Seen.")],
      tools: [{ name: "search_web", kind: "read", outside: true }],
      taken: [ownerMessage(1, "look at this picture", true)],
    });
    await turn.run();
    expect(recorder.steps[0]).toStrictEqual({ kind: "start", messages: ["msg_1"], outside: true });
    expect(recorder.steps.some((step) => step.kind === "engineMark")).toBe(false);
  });

  it("halts the turn when the engine does not take the mark: no later call runs", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply([{ name: "search_web" }, { name: "swap" }])],
      tools: [
        { name: "search_web", kind: "read", outside: true },
        { name: "swap", kind: "propose" },
      ],
      recorder: { failMark: true },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed", committed: false });
    expect(recorder.steps).toContainEqual({
      kind: "result",
      id: "swap",
      text: "not run: the turn ended after a failure",
      ran: false,
      outside: false,
    });
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "engine" },
    });
    expect(transport.requests).toHaveLength(1);
  });
});
