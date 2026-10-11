import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import type { ChatTurn, TurnReport } from "./chat-turn.js";
import { createTestTurn, ownerMessage, type TestTool, testTurnId } from "./test-turns.js";

// Runtime spec, invariants 3 and 10, over generated batches: a stop or a merge anywhere in a batch
// leaves every call with exactly one result after it, and no joining message between the two.

const kinds = ["parallel", "read", "control", "propose", "unknown"] as const;
type CallKind = (typeof kinds)[number];

interface Scenario {
  readonly calls: readonly CallKind[];
  /** The call during whose run the owner stops the turn, by its place; none past the end. */
  readonly stopAt: number;
  /** The call during whose run the owner writes again, by its place. */
  readonly writeAt: number;
}

const scenario: fc.Arbitrary<Scenario> = fc
  .array(fc.constantFrom(...kinds), { minLength: 1, maxLength: 6 })
  .chain((calls) =>
    fc.record({
      calls: fc.constant(calls),
      stopAt: fc.integer({ min: 0, max: calls.length }),
      writeAt: fc.integer({ min: 0, max: calls.length }),
    }),
  );

function placeOf(idempotencyKey: string): number {
  return Number(idempotencyKey.slice(testTurnId.length + 1)) - 1;
}

function toolsOf(recorder: TurnRecorder, holder: { turn?: ChatTurn }, test: Scenario): TestTool[] {
  const run: TestTool["run"] = async ({ idempotencyKey }) => {
    const place = placeOf(idempotencyKey);
    if (place === test.writeAt) {
      recorder.queue(ownerMessage(9, "one more thing"));
    }
    if (place === test.stopAt) {
      holder.turn?.stop("owner");
    }
    await Promise.resolve();
    return { text: "done", isError: false };
  };
  return [
    { name: "parallel", kind: "read", parallel: true, run },
    { name: "read", kind: "read", run },
    { name: "control", kind: "control", run },
    { name: "propose", kind: "propose", run },
  ];
}

function pairingProblems(steps: readonly RecordedStep[]): string[] {
  const open = new Set<string>();
  const answered = new Set<string>();
  const problems: string[] = [];
  for (const step of steps) {
    if (step.kind === "call" || step.kind === "proposal") {
      open.add(step.id);
    } else if (step.kind === "result") {
      problems.push(
        ...(open.delete(step.id) && !answered.has(step.id) ? [] : [`result ${step.id}`]),
      );
      answered.add(step.id);
    } else if (step.kind === "joined" && open.size > 0) {
      problems.push("a message joined between a call and its result");
    }
  }
  return [...problems, ...[...open].map((id) => `no result for ${id}`)];
}

// What a run broke of the invariants: an empty list when it kept them all.
function runProblems(test: Scenario, report: TurnReport, steps: readonly RecordedStep[]): string[] {
  const results = steps.flatMap((step) => (step.kind === "result" ? [step] : []));
  const stopRan = results.some((step) => step.id === `c${String(test.stopAt)}` && step.ran);
  const stopped = report.state === "ended" && report.outcome === "stopped";
  return [
    ...pairingProblems(steps),
    ...(results.length === test.calls.length ? [] : ["a call has no result"]),
    ...(stopped === stopRan ? [] : ["the turn ended stopped without a stop, or the reverse"]),
  ];
}

// A stopped turn makes the model call of its batch and none after it.
function modelCallsAfterStop(report: TurnReport, modelCalls: number): number {
  return report.state === "ended" && report.outcome === "stopped" ? modelCalls - 1 : 0;
}

describe("a stopped or merged batch", () => {
  it("leaves every call with exactly one result, and no message between a call and its result", async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (test) => {
        const holder: { turn?: ChatTurn } = {};
        const calls = test.calls.map((name, place) => ({ id: `c${String(place)}`, name }));
        const { turn, recorder, transport } = createTestTurn({
          replies: [callsReply(calls), textReply("Done.")],
          tools: (notes) => toolsOf(notes, holder, test),
        });
        holder.turn = turn;
        const report = await turn.run();
        expect(runProblems(test, report, recorder.steps)).toStrictEqual([]);
        expect(modelCallsAfterStop(report, transport.requests.length)).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});
