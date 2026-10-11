import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { callsReply, type ScriptedReply, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import type { ChatTurn, TurnReport } from "./chat-turn.js";
import { createTestTurn, ownerMessage, type TestTool, testTurnId } from "./test-turns.js";

// Runtime spec, invariants 1, 2 and 7, and decision 0167, over generated turns of up to five
// responses, each a batch of any calls, with messages and stops arriving during any call: no turn
// sends two proposals, a committed turn calls no model after its batch, and no turn runs more than
// 25 tool calls.

const kinds = ["parallel", "read", "control", "propose", "badPropose", "unknown"] as const;
type CallKind = (typeof kinds)[number];

/** What a call does while it runs. */
type Event = "none" | "write" | "stop";

interface GeneratedCall {
  readonly kind: CallKind;
  readonly event: Event;
}

const generatedCall: fc.Arbitrary<GeneratedCall> = fc.record({
  kind: fc.constantFrom(...kinds),
  event: fc.constantFrom<Event>("none", "none", "none", "write", "stop"),
});

const responses = fc.array(fc.array(generatedCall, { minLength: 1, maxLength: 12 }), {
  minLength: 1,
  maxLength: 5,
});

interface Script {
  readonly replies: readonly ScriptedReply[];
  /** What each call does, by its number in the turn, from 0. */
  readonly events: readonly Event[];
}

function scriptOf(batches: readonly (readonly GeneratedCall[])[]): Script {
  const replies = batches.map((batch, response) =>
    callsReply(
      batch.map((call, place) => ({
        id: `c${String(response)}_${String(place)}`,
        name: call.kind === "badPropose" ? "propose" : call.kind,
        args: call.kind === "badPropose" ? "{oops" : "{}",
      })),
    ),
  );
  const events = batches.flat().map((call) => call.event);
  return { replies: [...replies, textReply("Done.")], events };
}

interface Run {
  turn?: ChatTurn;
  readonly recorder?: TurnRecorder;
}

// A tool that notes each run, and does its call's event while it runs: the owner writes again,
// or stops the turn.
function toolOf(
  name: string,
  recorder: TurnRecorder,
  test: { readonly script: Script; readonly run: Run },
) {
  const body: TestTool["run"] = async ({ idempotencyKey }) => {
    recorder.note({ kind: "tool", name, key: idempotencyKey });
    const event = test.script.events[Number(idempotencyKey.slice(testTurnId.length + 1)) - 1];
    if (event === "write") {
      recorder.queue(ownerMessage(100, "one more thing"));
    }
    if (event === "stop") {
      test.run.turn?.stop("owner");
    }
    await Promise.resolve();
    return { text: "done", isError: false };
  };
  return body;
}

function toolsOf(
  recorder: TurnRecorder,
  test: { readonly script: Script; readonly run: Run },
): TestTool[] {
  return [
    { name: "parallel", kind: "read", parallel: true, run: toolOf("parallel", recorder, test) },
    { name: "read", kind: "read", run: toolOf("read", recorder, test) },
    { name: "control", kind: "control", run: toolOf("control", recorder, test) },
    { name: "propose", kind: "propose", run: toolOf("propose", recorder, test) },
  ];
}

function problemsOf(
  report: TurnReport,
  steps: readonly RecordedStep[],
  requests: number,
): string[] {
  const sent = steps.filter((step) => step.kind === "tool" && step.name === "propose");
  const proposals = steps.filter((step) => step.kind === "proposal");
  const proposalAt = steps.findIndex((step) => step.kind === "proposal");
  const callsBefore = steps
    .slice(0, Math.max(0, proposalAt))
    .filter((step) => step.kind === "response");
  const ran = steps.filter((step) => step.kind === "result" && step.ran);
  return [
    ...(sent.length <= 1 ? [] : [`${String(sent.length)} proposals reached the engine`]),
    ...(proposals.length <= 1 ? [] : ["two proposals were written"]),
    ...(proposalAt < 0 || requests === callsBefore.length
      ? []
      : ["a model call followed the proposal"]),
    ...(ran.length <= 25 ? [] : [`${String(ran.length)} calls ran`]),
    ...(report.state === "ended" && report.committed === proposalAt >= 0
      ? []
      : ["committed is wrong"]),
  ];
}

describe("one proposal per turn", () => {
  it("never sends two proposals, never calls the model after one, and runs at most 25 calls", async () => {
    await fc.assert(
      fc.asyncProperty(responses, async (batches) => {
        const test = { script: scriptOf(batches), run: {} satisfies Run as Run };
        const { turn, recorder, transport } = createTestTurn({
          replies: test.script.replies,
          tools: (journal) => toolsOf(journal, test),
        });
        test.run.turn = turn;
        const report = await turn.run();
        expect(problemsOf(report, recorder.steps, transport.requests.length)).toStrictEqual([]);
      }),
      { numRuns: 400 },
    );
  });
});
