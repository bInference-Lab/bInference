import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep } from "../testing/turn-recorder.js";
import type { ChatTurn } from "./chat-turn.js";
import type { ModelEvent } from "./model-event.js";
import { createGate, createTestTurn, type Gate, type TestTool, testTurnId } from "./test-turns.js";
import type { ToolOutcome, ToolRunContext } from "./turn-records.js";

// A tool body that waits until its signal aborts, then fails as a stopped tool does.
async function untilAborted({ signal }: ToolRunContext): Promise<ToolOutcome> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("stopped")));
  });
}

function resultsOf(steps: readonly RecordedStep[]): readonly (readonly [string, string])[] {
  return steps.flatMap((step) => (step.kind === "result" ? [[step.id, step.text] as const] : []));
}

const stoppedEvent: ModelEvent = { type: "error", failure: "aborted", message: "stopped" };
const doneEvent: ModelEvent = {
  type: "done",
  stop: "end",
  usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
};

// A model that writes a little, then waits for the test before it ends.
async function* halfAnswer(signal: AbortSignal, gate: Gate<undefined>): AsyncGenerator<ModelEvent> {
  yield { type: "text", delta: "Let me" };
  await gate.promise;
  yield signal.aborted ? stoppedEvent : doneEvent;
}

const holder: { turn?: ChatTurn } = {};
const stopNow: TestTool["run"] = async () => {
  holder.turn?.stop("owner");
  return { text: "ran first", isError: false };
};

describe("stopping a turn", () => {
  it("lets the running call finish and answers every later call as not run", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [
        callsReply([{ name: "first" }, { name: "second" }, { name: "third" }]),
        textReply("never"),
      ],
      tools: [
        { name: "first", kind: "read", run: stopNow },
        { name: "second", kind: "control" },
        { name: "third", kind: "read" },
      ],
    });
    holder.turn = turn;
    await expect(turn.run()).resolves.toMatchObject({ outcome: "stopped", modelCalls: 1 });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["first", "ran first"],
      ["second", "not run: the owner stopped the agent"],
      ["third", "not run: the owner stopped the agent"],
    ]);
    expect(recorder.steps.slice(-3)).toStrictEqual([
      { kind: "status", line: { line: "stopped" } },
      { kind: "journalEnd", outcome: "stopped", heldBack: 0 },
      { kind: "end", outcome: "stopped" },
    ]);
    expect(transport.requests).toHaveLength(1);
  });

  it("stops the reads of a parallel batch that can stop, and gives each its result", async () => {
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "quote" }, { name: "chart" }])],
      tools: [
        { name: "quote", kind: "read", parallel: true, run: untilAborted },
        { name: "chart", kind: "read", parallel: true, run: untilAborted },
      ],
    });
    const report = turn.run();
    await clock.advance(0);
    turn.stop("freeze");
    await expect(report).resolves.toMatchObject({ outcome: "stopped" });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["quote", "stopped before it finished: the turn was stopped"],
      ["chart", "stopped before it finished: the turn was stopped"],
    ]);
  });

  it("stops a model call while it streams, and keeps what the model wrote", async () => {
    const gate = createGate<undefined>();
    const { turn, recorder, clock } = createTestTurn({
      replies: [(signal) => halfAnswer(signal, gate)],
    });
    const report = turn.run();
    await clock.advance(0);
    expect(turn.state).toBe("streaming");
    turn.stop("owner");
    gate.open(undefined);
    await expect(report).resolves.toMatchObject({ outcome: "stopped", modelCalls: 1 });
    expect(recorder.steps).toContainEqual({ kind: "say", text: "Let me" });
  });

  it("gives a proposal already sent 5 seconds after a stop to finish", async () => {
    const answer = createGate<ToolOutcome>();
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "swap" }, { name: "portfolio" }])],
      tools: [
        { name: "swap", kind: "propose", run: async () => answer.promise },
        { name: "portfolio", kind: "read" },
      ],
    });
    const report = turn.run();
    await clock.advance(0);
    turn.stop("owner");
    await clock.advance(4_999);
    answer.open({ text: "int_1 waits for the owner's confirmation", isError: false });
    await expect(report).resolves.toMatchObject({ outcome: "stopped", committed: true });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["swap", "int_1 waits for the owner's confirmation"],
      ["portfolio", "not run: the owner stopped the agent"],
    ]);
  });

  it("says the card is still open when a stop ends a turn whose proposal the engine took", async () => {
    const answer = createGate<ToolOutcome>();
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "swap" }])],
      tools: [{ name: "swap", kind: "propose", run: async () => answer.promise }],
    });
    const report = turn.run();
    await clock.advance(0);
    turn.stop("freeze");
    answer.open({ text: "int_1 waits for the owner's confirmation", isError: false });
    await expect(report).resolves.toMatchObject({ outcome: "stopped", committed: true });
    expect(recorder.steps.filter((step) => step.kind === "status")).toStrictEqual([
      { kind: "status", line: { line: "stoppedCardOpen" } },
    ]);
  });

  it("keeps the plain stop line when the engine refused the stopped turn's proposal", async () => {
    const answer = createGate<ToolOutcome>();
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "swap" }])],
      tools: [{ name: "swap", kind: "propose", run: async () => answer.promise }],
    });
    const report = turn.run();
    await clock.advance(0);
    turn.stop("owner");
    answer.open({ text: "refused: the wallet is not the agent's", isError: true });
    await expect(report).resolves.toMatchObject({ outcome: "stopped", committed: true });
    expect(recorder.steps.filter((step) => step.kind === "status")).toStrictEqual([
      { kind: "status", line: { line: "stopped" } },
    ]);
  });

  it("calls a proposal with no answer 5 seconds after a stop unknown, and never sends it again", async () => {
    const { turn, recorder, clock, transport } = createTestTurn({
      replies: [callsReply([{ name: "swap" }])],
      tools: [{ name: "swap", kind: "propose", run: untilAborted }],
    });
    const report = turn.run();
    await clock.advance(0);
    turn.stop("owner");
    await clock.advance(5_000);
    await expect(report).resolves.toMatchObject({ outcome: "stopped", committed: true });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["swap", "outcome unknown: the engine did not answer, and this proposal is never sent again"],
    ]);
    expect(recorder.steps.filter((step) => step.kind === "proposal")).toStrictEqual([
      { kind: "proposal", id: "swap", key: `${testTurnId}.1` },
    ]);
    expect(transport.requests).toHaveLength(1);
  });

  it("ends failed when a proposal gets no answer within 30 seconds", async () => {
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "swap" }, { name: "portfolio" }])],
      tools: [
        { name: "swap", kind: "propose", run: untilAborted },
        { name: "portfolio", kind: "read" },
      ],
    });
    const report = turn.run();
    await clock.advance(30_000);
    await expect(report).resolves.toMatchObject({ outcome: "failed", committed: true });
    expect(resultsOf(recorder.steps)[1]).toStrictEqual([
      "portfolio",
      "not run: the turn ended after a failure",
    ]);
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "proposal_unknown" },
    });
  });

  it("ends failed when the turn reaches its 10 minutes, as a stop does", async () => {
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }, { name: "chart" }])],
      tools: [
        { name: "portfolio", kind: "read", run: untilAborted },
        { name: "chart", kind: "read" },
      ],
      limits: { toolTimeoutMs: 3_600_000 },
    });
    const report = turn.run();
    await clock.advance(600_000);
    await expect(report).resolves.toMatchObject({ outcome: "failed" });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["portfolio", "stopped before it finished: the turn was stopped"],
      ["chart", "not run: the turn reached its time limit"],
    ]);
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "time_limit" },
    });
  });

  it("ends a turn stopped before its first model call without calling the model", async () => {
    const { turn, transport } = createTestTurn({ replies: [textReply("never")] });
    turn.stop("clear");
    await expect(turn.run()).resolves.toMatchObject({ outcome: "stopped", modelCalls: 0 });
    expect(transport.requests).toHaveLength(0);
  });
});

describe("a committed turn", () => {
  it("writes the proposal with its key before the tool reaches the engine, and calls no model after", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [
        callsReply([{ name: "portfolio" }, { name: "swap" }, { name: "alert_create" }], "Buying."),
      ],
      tools: (notes) => [
        { name: "portfolio", kind: "read" },
        {
          name: "swap",
          kind: "propose",
          run: async ({ idempotencyKey }) => {
            notes.note({ kind: "tool", name: "swap", key: idempotencyKey });
            return { text: "int_1 waits for the owner's confirmation", isError: false };
          },
        },
        { name: "alert_create", kind: "control" },
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({
      outcome: "ok",
      committed: true,
      modelCalls: 1,
    });
    expect(recorder.steps.slice(5, 10)).toStrictEqual([
      { kind: "proposal", id: "swap", key: `${testTurnId}.2` },
      { kind: "tool", name: "swap", key: `${testTurnId}.2` },
      {
        kind: "result",
        id: "swap",
        text: "int_1 waits for the owner's confirmation",
        ran: true,
        outside: false,
      },
      { kind: "call", id: "alert_create", name: "alert_create" },
      { kind: "result", id: "alert_create", text: "ran alert_create", ran: true, outside: false },
    ]);
    expect(recorder.steps.slice(-4)).toStrictEqual([
      { kind: "say", text: "Buying." },
      { kind: "status", line: { line: "proposalWaits" } },
      { kind: "journalEnd", outcome: "ok", heldBack: 0 },
      { kind: "end", outcome: "ok" },
    ]);
    expect(transport.requests).toHaveLength(1);
  });

  it("stays committed and ends ok when the engine refuses the proposal", async () => {
    const { turn, transport } = createTestTurn({
      replies: [callsReply([{ name: "swap" }]), textReply("never")],
      tools: [
        {
          name: "swap",
          kind: "propose",
          run: async () => ({ text: "refused: over the daily cap", isError: true }),
        },
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(transport.requests).toHaveLength(1);
  });
});

// The owner stops the turn while the loop writes a step of this kind.
function stopDuring(kind: RecordedStep["kind"], stopper: { turn?: ChatTurn }) {
  return (step: RecordedStep): void => {
    if (step.kind === kind) {
      stopper.turn?.stop("owner");
    }
  };
}

describe("a stop while a call is written", () => {
  it("sends no proposal when the stop lands as the proposal is written", async () => {
    const stopper: { turn?: ChatTurn } = {};
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "swap" }])],
      tools: (notes) => [
        {
          name: "swap",
          kind: "propose",
          run: async ({ idempotencyKey }) => {
            notes.note({ kind: "tool", name: "swap sent", key: idempotencyKey });
            return { text: "int_1 waits", isError: false };
          },
        },
      ],
      recorder: { beforeStep: stopDuring("proposal", stopper) },
    });
    stopper.turn = turn;
    await expect(turn.run()).resolves.toMatchObject({ outcome: "stopped", committed: true });
    expect(recorder.steps.some((step) => step.kind === "tool")).toBe(false);
    expect(recorder.steps).toContainEqual({
      kind: "result",
      id: "swap",
      text: "not run: the owner stopped the agent",
      ran: false,
      outside: false,
    });
  });

  it("starts no tool when the stop lands as its call is written", async () => {
    const stopper: { turn?: ChatTurn } = {};
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "alert_create" }])],
      tools: (notes) => [
        {
          name: "alert_create",
          kind: "control",
          run: async () => {
            notes.note({ kind: "tool", name: "alert made", key: "" });
            return { text: "made", isError: false };
          },
        },
      ],
      recorder: { beforeStep: stopDuring("call", stopper) },
    });
    stopper.turn = turn;
    await expect(turn.run()).resolves.toMatchObject({ outcome: "stopped" });
    expect(recorder.steps.some((step) => step.kind === "tool")).toBe(false);
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["alert_create", "not run: the owner stopped the agent"],
    ]);
  });

  it("ends stopped when the stop lands as the engine takes the mark", async () => {
    const stopper: { turn?: ChatTurn } = {};
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply([{ name: "search_web" }, { name: "swap" }]), textReply("never")],
      tools: [
        { name: "search_web", kind: "read", outside: true },
        { name: "swap", kind: "propose" },
      ],
      recorder: { beforeStep: stopDuring("engineMark", stopper) },
    });
    stopper.turn = turn;
    await expect(turn.run()).resolves.toMatchObject({ outcome: "stopped", committed: false });
    expect(resultsOf(recorder.steps).at(-1)).toStrictEqual([
      "swap",
      "not run: the owner stopped the agent",
    ]);
    expect(transport.requests).toHaveLength(1);
  });
});

describe("the status line of a committed turn", () => {
  it("says the proposal waits only when the engine took it", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "swap" }, { name: "swap", id: "again" }])],
      tools: [
        {
          name: "swap",
          kind: "propose",
          run: async () => ({ text: "refused: the agent is frozen", isError: true }),
        },
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({
      outcome: "ok",
      committed: true,
      heldBack: 1,
    });
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "proposalRefused" } });
    expect(recorder.steps.filter((step) => step.kind === "status")).toHaveLength(1);
  });
});
