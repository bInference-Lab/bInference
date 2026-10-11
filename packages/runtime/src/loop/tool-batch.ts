import type { BatchCall, BatchEnd } from "./batch-call.js";
import type { ToolCall } from "./model-message.js";
import { recordNotRun } from "./record-call.js";
import { runOrderedBatch } from "./run-ordered-batch.js";
import { runParallelBatch } from "./run-parallel-batch.js";
import { haltOf } from "./turn-halt.js";
import type { TurnRun } from "./turn-run.js";

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
  const first = run.tally.now().toolCalls;
  const room = Math.max(0, run.limits.maxToolCalls - first);
  run.tally.countToolCalls(toolCalls.length);
  run.tally.enter("tools");
  const calls = toolCalls.slice(0, room).map((call, index) => ({
    call,
    ordinal: first + index + 1,
    prepared: run.parts.tools.prepare(call),
  }));
  const end = isParallel(calls)
    ? await runParallelBatch(run, calls)
    : await runOrderedBatch(run, calls);
  const over = toolCalls.slice(room);
  await refuseOverLimit(run, over);
  return { ...end, reachedLimit: over.length > 0 };
}
