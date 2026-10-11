import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep } from "../testing/turn-recorder.js";
import { createTestTurn, ownerMessage } from "./test-turns.js";

// Runtime spec, section 4.3 and invariant 3: whatever a port throws, the turn still ends, writes
// its end and tells the engine, and every call it wrote keeps one result.

function failOn(kind: RecordedStep["kind"]) {
  return (step: RecordedStep): void => {
    if (step.kind === kind) {
      throw new Error(`The write of ${kind} failed.`);
    }
  };
}

// Only the first write of a kind fails, as a disk that filled up for a moment.
function failFirst(kind: RecordedStep["kind"]) {
  const seen = { count: 0 };
  return (step: RecordedStep): void => {
    seen.count += step.kind === kind ? 1 : 0;
    if (step.kind === kind && seen.count === 1) {
      throw new Error(`The write of ${kind} failed.`);
    }
  };
}

function hangOn(kind: RecordedStep["kind"]) {
  return async (step: RecordedStep): Promise<void> => {
    if (step.kind === kind) {
      await new Promise(() => undefined);
    }
  };
}

function tail(steps: readonly RecordedStep[]): readonly string[] {
  return steps.slice(-2).map((step) => step.kind);
}

function results(steps: readonly RecordedStep[]): readonly (readonly [string, string])[] {
  return steps.flatMap((step) => (step.kind === "result" ? [[step.id, step.text] as const] : []));
}

describe("a port that throws", () => {
  it("ends the turn failed and still writes its end when the final text cannot be sent", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      recorder: { beforeStep: failOn("say") },
    });
    await expect(turn.run()).resolves.toMatchObject({ state: "ended", outcome: "failed" });
    expect(recorder.steps.slice(-3)).toStrictEqual([
      { kind: "status", line: { line: "failed", failure: "engine" } },
      { kind: "journalEnd", outcome: "failed", heldBack: 0 },
      { kind: "end", outcome: "failed" },
    ]);
  });

  it("answers a written call whose result could not be written, and ends failed", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [callsReply([{ name: "portfolio" }, { name: "chart" }]), textReply("never")],
      tools: [
        { name: "portfolio", kind: "read" },
        { name: "chart", kind: "read" },
      ],
      recorder: { beforeStep: failFirst("result") },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed" });
    expect(results(recorder.steps)).toStrictEqual([
      ["portfolio", "not run: the turn ended after a failure"],
    ]);
    expect(tail(recorder.steps)).toStrictEqual(["journalEnd", "end"]);
    expect(transport.requests).toHaveLength(1);
  });

  it("calls a proposal written but never answered unknown when the turn fails around it", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ name: "swap" }])],
      tools: [{ name: "swap", kind: "propose" }],
      recorder: { beforeStep: failOn("result") },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed", committed: true });
    expect(tail(recorder.steps)).toStrictEqual(["journalEnd", "end"]);
  });

  it("ends failed when the chat queue cannot be read", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      recorder: { failTake: true },
    });
    recorder.queue(ownerMessage(2, "more"));
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed" });
    expect(tail(recorder.steps)).toStrictEqual(["journalEnd", "end"]);
  });

  it("still tells the engine the turn ended when the journal end fails", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [textReply("Hi.")],
      recorder: { beforeStep: failOn("journalEnd") },
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "failed" });
    expect(recorder.steps.at(-1)).toStrictEqual({ kind: "end", outcome: "failed" });
  });

  it("gives up on an end the engine never answers after its own time", async () => {
    const { turn, clock } = createTestTurn({
      replies: [textReply("Hi.")],
      recorder: { beforeStep: hangOn("end") },
    });
    const report = turn.run();
    await clock.advance(10_000);
    await expect(report).resolves.toMatchObject({ outcome: "failed" });
  });

  it("counts a turn the engine could not be asked to start as not started", async () => {
    const { turn, transport } = createTestTurn({
      replies: [textReply("Hi.")],
      recorder: { failStart: true },
    });
    await expect(turn.run()).resolves.toStrictEqual({ state: "refused", refusal: "unavailable" });
    expect(transport.requests).toHaveLength(0);
  });
});
