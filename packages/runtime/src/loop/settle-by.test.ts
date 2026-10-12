import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { ModelEvent } from "./model-event.js";
import { createTestTurn, type TestTool, testTurnId } from "./test-turns.js";
import type { ToolOutcome, ToolRunContext } from "./turn-records.js";

// Tools and models that ignore their signal: the loop itself settles each call at its deadline.

async function never(): Promise<ToolOutcome> {
  return new Promise(() => undefined);
}

// A tool that answers only after its signal aborted, as if it had sent its call anyway.
async function lateAnswer({ signal }: ToolRunContext): Promise<ToolOutcome> {
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve({ text: "cancelled", isError: true }));
  });
}

async function* stalls(): AsyncGenerator<ModelEvent> {
  yield { type: "text", delta: "Thinking" };
  await new Promise(() => undefined);
}

function resultsOf(steps: readonly { readonly kind: string }[]) {
  return steps.flatMap((step) =>
    step.kind === "result" && "id" in step && "text" in step ? [[step.id, step.text]] : [],
  );
}

describe("calls that ignore their signal", () => {
  it("gives a read that never answers its timeout at 60 seconds, and goes on", async () => {
    const { turn, recorder, clock, transport } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }]), textReply("Slow.")],
      tools: [{ name: "portfolio", kind: "read", run: never }],
    });
    const report = turn.run();
    await clock.advance(60_000);
    await expect(report).resolves.toMatchObject({ outcome: "ok", modelCalls: 2 });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["portfolio", "failed: no answer within 60 seconds"],
    ]);
    expect(transport.requests).toHaveLength(2);
  });

  it("never lets a hung read hold a parallel batch past its deadline", async () => {
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "quote" }, { name: "chart" }]), textReply("Partly.")],
      tools: [
        { name: "quote", kind: "read", parallel: true, run: never },
        { name: "chart", kind: "read", parallel: true },
      ],
    });
    const report = turn.run();
    await clock.advance(60_000);
    await expect(report).resolves.toMatchObject({ outcome: "ok" });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["quote", "failed: no answer within 60 seconds"],
      ["chart", "ran chart"],
    ]);
  });

  it("ends a stopped turn at once though its running read never answers", async () => {
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }])],
      tools: [{ name: "portfolio", kind: "read", run: never }],
    });
    const report = turn.run();
    await clock.advance(0);
    turn.stop("owner");
    await clock.advance(0);
    await expect(report).resolves.toMatchObject({ outcome: "stopped" });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["portfolio", "stopped before it finished: the turn was stopped"],
    ]);
  });

  it("calls a proposal that never answers unknown at 30 seconds, and never sends it again", async () => {
    const sent: string[] = [];
    const swap: TestTool = {
      name: "swap",
      kind: "propose",
      run: async ({ idempotencyKey }) => {
        sent.push(idempotencyKey);
        return never();
      },
    };
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "swap" }])],
      tools: [swap],
    });
    const report = turn.run();
    await clock.advance(30_000);
    await expect(report).resolves.toMatchObject({ outcome: "failed", committed: true });
    expect(sent).toStrictEqual([`${testTurnId}.1`]);
    expect(recorder.steps).toContainEqual({
      kind: "status",
      line: { line: "failed", failure: "proposal_unknown" },
    });
  });

  it("calls a proposal that answers only after its deadline unknown", async () => {
    const { turn, recorder, clock } = createTestTurn({
      replies: [callsReply([{ name: "swap" }])],
      tools: [{ name: "swap", kind: "propose", run: lateAnswer }],
    });
    const report = turn.run();
    await clock.advance(30_000);
    await expect(report).resolves.toMatchObject({ outcome: "failed" });
    expect(resultsOf(recorder.steps)).toStrictEqual([
      ["swap", "outcome unknown: the engine did not answer, and this proposal is never sent again"],
    ]);
  });

  it("ends a stopped turn at once though its model stream ignores the stop", async () => {
    const { turn, recorder, clock } = createTestTurn({ replies: [stalls] });
    const report = turn.run();
    await clock.advance(0);
    turn.stop("owner");
    await clock.advance(0);
    await expect(report).resolves.toMatchObject({ outcome: "stopped", modelCalls: 1 });
    expect(recorder.steps).toContainEqual({ kind: "say", text: "Thinking" });
  });

  it("ends a turn whose model stream stalls at its 10 minutes", async () => {
    const { turn, clock } = createTestTurn({ replies: [stalls] });
    const report = turn.run();
    await clock.advance(600_000);
    await expect(report).resolves.toMatchObject({ outcome: "failed" });
  });
});
