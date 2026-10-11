import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { callsReply, type ScriptedReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import type { ChatTurn } from "./chat-turn.js";
import type { ModelEvent } from "./model-event.js";
import { createTestTurn, type TestTool } from "./test-turns.js";

// Runtime spec, invariants 1, 3 and 5, over generated turns whose responses mix outside-content
// reads, other calls, proposals and responses cut off at the output limit, with the owner's stop
// landing at any write: a proposal sent after an outside result is sent only after the engine
// took the mark, no turn sends two, and every call written keeps exactly one result.

const kinds = ["outside", "read", "parallel", "control", "propose"] as const;
type CallKind = (typeof kinds)[number];

interface Response {
  readonly calls: readonly CallKind[];
  readonly cutOff: boolean;
}

interface Scenario {
  readonly responses: readonly Response[];
  /** The write during which the owner stops the turn, by its place; none past the last. */
  readonly stopAt: number;
}

const scenario: fc.Arbitrary<Scenario> = fc.record({
  responses: fc.array(
    fc.record({
      calls: fc.array(fc.constantFrom(...kinds), { minLength: 1, maxLength: 6 }),
      cutOff: fc.boolean(),
    }),
    { minLength: 1, maxLength: 4 },
  ),
  stopAt: fc.integer({ min: 0, max: 80 }),
});

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };

function replyOf(response: Response, place: number): readonly ModelEvent[] {
  const calls = response.calls.map((name, index) => ({
    id: `c${String(place)}_${String(index)}`,
    name,
  }));
  const events = callsReply(calls);
  return response.cutOff
    ? [...events.filter((event) => event.type !== "done"), { type: "done", stop: "length", usage }]
    : events;
}

function repliesOf(test: Scenario): readonly ScriptedReply[] {
  return [...test.responses.map(replyOf), textReply("Done.")];
}

function toolsOf(recorder: TurnRecorder): TestTool[] {
  const run =
    (name: string): NonNullable<TestTool["run"]> =>
    async ({ idempotencyKey }) => {
      recorder.note({ kind: "tool", name, key: idempotencyKey });
      await Promise.resolve();
      return { text: "done", isError: false };
    };
  return [
    { name: "outside", kind: "read", outside: true, run: run("outside") },
    { name: "read", kind: "read", run: run("read") },
    { name: "parallel", kind: "read", parallel: true, run: run("parallel") },
    { name: "control", kind: "control", run: run("control") },
    { name: "propose", kind: "propose", run: run("propose") },
  ];
}

// Stops the turn as the loop writes its `stopAt`th step.
function stopAtWrite(test: Scenario, holder: { turn?: ChatTurn }) {
  const seen = { writes: 0 };
  return (): void => {
    seen.writes += 1;
    if (seen.writes === test.stopAt) {
      holder.turn?.stop("owner");
    }
  };
}

function pairingProblems(steps: readonly RecordedStep[]): string[] {
  const open = new Set<string>();
  const problems: string[] = [];
  for (const step of steps) {
    if (step.kind === "call" || step.kind === "proposal") {
      open.add(step.id);
    } else if (step.kind === "result" && !open.delete(step.id)) {
      problems.push(`a result for ${step.id} with no open call`);
    }
  }
  return [...problems, ...[...open].map((id) => `no result for ${id}`)];
}

function markProblems(steps: readonly RecordedStep[]): string[] {
  const sentAt = steps.findIndex((step) => step.kind === "tool" && step.name === "propose");
  const outsideAt = steps.findIndex((step) => step.kind === "result" && step.outside);
  const markAt = steps.findIndex((step) => step.kind === "engineMark");
  const marks = steps.filter((step) => step.kind === "engineMark").length;
  const sentAfterOutside = sentAt >= 0 && outsideAt >= 0 && outsideAt < sentAt;
  return [
    ...(sentAfterOutside && (markAt < 0 || markAt > sentAt)
      ? ["a proposal went out unmarked"]
      : []),
    ...(marks <= 1 ? [] : [`${String(marks)} marks`]),
  ];
}

function sendProblems(steps: readonly RecordedStep[]): string[] {
  const sent = steps.filter((step) => step.kind === "tool" && step.name === "propose").length;
  return sent <= 1 ? [] : [`${String(sent)} proposals reached the engine`];
}

describe("the outside-content mark under stops at any write", () => {
  it("never sends a proposal unmarked after outside content, or two, and answers every call", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (test) => {
        const holder: { turn?: ChatTurn } = {};
        const { turn, recorder } = createTestTurn({
          replies: repliesOf(test),
          tools: toolsOf,
          recorder: { beforeStep: stopAtWrite(test, holder) },
        });
        holder.turn = turn;
        await expect(turn.run()).resolves.toMatchObject({ state: "ended" });
        expect([
          ...pairingProblems(recorder.steps),
          ...markProblems(recorder.steps),
          ...sendProblems(recorder.steps),
        ]).toStrictEqual([]);
      }),
      { numRuns: 400 },
    );
  });
});
