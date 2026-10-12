import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import { createTestTurn, ownerMessage, type TestTool } from "./test-turns.js";

const heldBackText =
  "not run: one proposal at a time; propose it again after the owner answers this one";

// A propose tool that notes each proposal it sends to the engine.
function proposer(name: string) {
  return (recorder: TurnRecorder): TestTool => ({
    name,
    kind: "propose",
    run: async ({ idempotencyKey }) => {
      recorder.note({ kind: "tool", name, key: idempotencyKey });
      return { text: `${name} waits for the owner's confirmation`, isError: false };
    },
  });
}

function resultsOf(steps: readonly RecordedStep[]): readonly (readonly [string, string])[] {
  return steps.flatMap((step) => (step.kind === "result" ? [[step.id, step.text] as const] : []));
}

function sent(steps: readonly RecordedStep[]): readonly string[] {
  return steps.flatMap((step) => (step.kind === "tool" ? [step.name] : []));
}

function reads(count: number, from: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `r${String(from + index)}`,
    name: "portfolio",
    // Each read asks for another page, so the loop guard sees no repeat.
    args: { page: from + index },
  }));
}

describe("one proposal per turn", () => {
  it("runs the first proposal of a response, holds back the rest, and runs every other call", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [
        callsReply([
          { id: "a", name: "buy" },
          { id: "r", name: "portfolio" },
          { id: "b", name: "sell" },
          { id: "c", name: "alert_create" },
          { id: "d", name: "buy" },
        ]),
        textReply("never"),
      ],
      tools: (notes) => [
        proposer("buy")(notes),
        proposer("sell")(notes),
        { name: "portfolio", kind: "read" },
        { name: "alert_create", kind: "control" },
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({
      outcome: "ok",
      committed: true,
      heldBack: 2,
      toolCalls: 5,
    });
    expect(sent(recorder.steps)).toStrictEqual(["buy"]);
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["a", "buy waits for the owner's confirmation"],
      ["r", "ran portfolio"],
      ["b", heldBackText],
      ["c", "ran alert_create"],
      ["d", heldBackText],
    ]);
    expect(recorder.steps.slice(-3)).toStrictEqual([
      { kind: "status", line: { line: "moreProposals", count: 2 } },
      { kind: "journalEnd", outcome: "ok", heldBack: 2 },
      { kind: "end", outcome: "ok" },
    ]);
    expect(transport.requests).toHaveLength(1);
  });

  it("lets the next proposal run when the one before it failed its check", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([
          { id: "a", name: "buy", args: "{oops" },
          { id: "b", name: "buy" },
        ]),
      ],
      tools: (notes) => [proposer("buy")(notes)],
    });
    await expect(turn.run()).resolves.toMatchObject({ committed: true, heldBack: 0 });
    expect(sent(recorder.steps)).toStrictEqual(["buy"]);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "proposalWaits" } });
  });

  it("starts a new turn for a message that arrives in a committed turn", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "buy" }, { name: "portfolio" }])],
      tools: (notes) => [
        proposer("buy")(notes),
        {
          name: "portfolio",
          kind: "read",
          run: async () => {
            notes.queue(ownerMessage(2, "and a stop-loss"));
            return { text: "ok", isError: false };
          },
        },
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({ committed: true, modelCalls: 1 });
    await expect(recorder.merge.take(new AbortController().signal)).resolves.toHaveLength(1);
  });
});

describe("the tool call limit", () => {
  it("gives the 26th call of a turn its limit result, and ends the turn after the batch", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply(reads(20, 1)), callsReply(reads(6, 21)), textReply("never")],
      tools: [{ name: "portfolio", kind: "read" }],
    });
    await expect(turn.run()).resolves.toMatchObject({
      outcome: "loop",
      toolCalls: 26,
      modelCalls: 2,
    });
    const results = resultsOf(recorder.steps);
    expect(results).toHaveLength(26);
    expect(results.slice(19, 21)).toStrictEqual([
      ["r20", "ran portfolio"],
      ["r21", "ran portfolio"],
    ]);
    expect(results.slice(24)).toStrictEqual([
      ["r25", "ran portfolio"],
      ["r26", "not run: the turn reached its tool call limit"],
    ]);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "toolCallLimit" } });
    expect(transport.requests).toHaveLength(2);
  });

  it("lets a turn of exactly 25 calls go on to its answer", async () => {
    const { turn } = createTestTurn({
      replies: [callsReply(reads(25, 1)), textReply("All read.")],
      tools: [{ name: "portfolio", kind: "read" }],
    });
    await expect(turn.run()).resolves.toMatchObject({
      outcome: "ok",
      toolCalls: 25,
      modelCalls: 2,
    });
  });

  it("refuses a proposal past the limit, so it never reaches the engine", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([...reads(25, 1), { id: "p", name: "buy" }])],
      tools: (notes) => [{ name: "portfolio", kind: "read" }, proposer("buy")(notes)],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "loop", committed: false });
    expect(sent(recorder.steps)).toStrictEqual([]);
    expect(resultsOf(recorder.steps).at(-1)).toStrictEqual([
      "p",
      "not run: the turn reached its tool call limit",
    ]);
  });

  it("ends a committed turn that also reached the limit ok, with its proposal's status line", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ id: "p", name: "buy" }, ...reads(25, 1)])],
      tools: (notes) => [{ name: "portfolio", kind: "read" }, proposer("buy")(notes)],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "proposalWaits" } });
  });
});

const cardAsksText = "not run: the card already asks the owner";

// The control tool that asks the owner; it notes each question it sends.
function asker(recorder: TurnRecorder): TestTool {
  return {
    name: "ask_owner",
    kind: "control",
    asksOwner: true,
    run: async () => {
      recorder.note({ kind: "tool", name: "ask_owner", key: "" });
      return {
        text: "asked; the answer comes as the owner's next message",
        isError: false,
        endsTurn: true,
      };
    },
  };
}

describe("a proposal and a question in one batch", () => {
  it.each([
    ["before", [{ name: "ask_owner" }, { name: "swap" }]],
    ["after", [{ name: "swap" }, { name: "ask_owner" }]],
  ])("runs the proposal and not a question %s it", async (_place, calls) => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply(calls), textReply("never")],
      tools: (journal) => [proposer("swap")(journal), asker(journal)],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(sent(recorder.steps)).toStrictEqual(["swap"]);
    expect(resultsOf(recorder.steps)).toContainEqual(["ask_owner", cardAsksText]);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "proposalWaits" } });
    expect(transport.requests).toHaveLength(1);
  });

  it("asks the owner when no proposal is in the batch", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply([{ name: "ask_owner" }]), textReply("never")],
      tools: (journal) => [asker(journal)],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: false });
    expect(sent(recorder.steps)).toStrictEqual(["ask_owner"]);
    expect(transport.requests).toHaveLength(1);
  });

  it("still asks beside a proposal the tool box refused", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "swap", args: "not json" }, { name: "ask_owner" }])],
      tools: (journal) => [proposer("swap")(journal), asker(journal)],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: false });
    expect(sent(recorder.steps)).toStrictEqual(["ask_owner"]);
  });
});
