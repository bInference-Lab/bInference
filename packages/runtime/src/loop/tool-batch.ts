import type { BatchCall, BatchEnd } from "./batch-call.js";
import type { ToolCall } from "./model-message.js";
import { recordNotRun } from "./record-call.js";
import { runOrderedBatch } from "./run-ordered-batch.js";
import { runParallelBatch } from "./run-parallel-batch.js";
import { haltOf } from "./turn-halt.js";
import type { PreparedCall } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

const unreadable = "not run: the arguments could not be read";

// A tool box that throws, on arguments it did not expect, refuses that call and breaks nothing.
function prepared(run: TurnRun, call: ToolCall): PreparedCall {
  try {
    return run.parts.tools.prepare(call);
  } catch {
    return { ready: false, text: unreadable };
  }
}

// Reads that allow it run together; a refused call has its result already and takes no part.
function isParallel(calls: readonly BatchCall[]): boolean {
  const ready = calls.flatMap((item) => (item.prepared.ready ? [item.prepared] : []));
  return ready.length > 1 && ready.every((call) => call.kind === "read" && call.parallel);
}

// Calls past the turn's limit never run (runtime spec, section 9); a halt names its own reason.
async function refuseOverLimit(run: TurnRun, calls: readonly ToolCall[]): Promise<void> {
  for (const call of calls) {
    const reason = run.halted.aborted ? haltOf(run.halted) : "limit";
    // oxlint-disable-next-line eslint/no-await-in-loop -- results keep the calls' order
    await recordNotRun(run, call, reason);
  }
}

/** A batch's calls split at the turn's tool call limit, numbered from the turn's count so far. */
interface Admission {
  readonly first: number;
  readonly admitted: readonly ToolCall[];
  readonly over: readonly ToolCall[];
}

// Every call the model makes counts toward the limit, run or not (decision 0171).
function admit(run: TurnRun, toolCalls: readonly ToolCall[]): Admission {
  const first = run.tally.now().toolCalls;
  const room = Math.max(0, run.limits.maxToolCalls - first);
  run.tally.countToolCalls(toolCalls.length);
  run.tally.enter("tools");
  return { first, admitted: toolCalls.slice(0, room), over: toolCalls.slice(room) };
}

/**
 * Runs the tool calls of one model response: each checked by the tool box and numbered in the
 * turn, then run in parallel when all are reads that allow it, else in the model's order. Calls
 * past the turn's tool call limit get their "not run" result after the others, and the turn ends
 * after the batch.
 */
export async function runToolBatch(
  run: TurnRun,
  toolCalls: readonly ToolCall[],
): Promise<BatchEnd> {
  const { first, admitted, over } = admit(run, toolCalls);
  const calls = admitted.map((call, index) => ({
    call,
    ordinal: first + index + 1,
    prepared: prepared(run, call),
  }));
  const end = isParallel(calls)
    ? await runParallelBatch(run, calls)
    : await runOrderedBatch(run, calls, { overLimit: over.length > 0 });
  await refuseOverLimit(run, over);
  return { ...end, reachedLimit: over.length > 0 };
}

/**
 * Answers the calls of a response cut off at its output limit, none of which runs: each within
 * the limit gets the cut-off result, each past it the limit's, and the turn ends after it when a
 * call went past.
 */
export async function runCutOffBatch(
  run: TurnRun,
  toolCalls: readonly ToolCall[],
): Promise<BatchEnd> {
  const { admitted, over } = admit(run, toolCalls);
  for (const call of admitted) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- results keep the calls' order
    await recordNotRun(run, call, run.halted.aborted ? haltOf(run.halted) : "cut_off");
  }
  await refuseOverLimit(run, over);
  return { askedOwner: false, joined: [], reachedLimit: over.length > 0 };
}
