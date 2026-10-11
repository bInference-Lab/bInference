import type { BatchCall, BatchEnd } from "./batch-call.js";
import type { ToolCall } from "./model-message.js";
import { runOrderedBatch } from "./run-ordered-batch.js";
import { runParallelBatch } from "./run-parallel-batch.js";
import type { TurnRun } from "./turn-run.js";

// Reads that allow it run together; a refused call has its result already and takes no part.
function isParallel(calls: readonly BatchCall[]): boolean {
  const ready = calls.flatMap((item) => (item.prepared.ready ? [item.prepared] : []));
  return ready.length > 1 && ready.every((call) => call.kind === "read" && call.parallel);
}

/**
 * Runs the tool calls of one model response: each checked by the tool box and numbered in the
 * turn, then run in parallel when all are reads that allow it, else in the model's order.
 */
export async function runToolBatch(
  run: TurnRun,
  toolCalls: readonly ToolCall[],
): Promise<BatchEnd> {
  const first = run.tally.now().toolCalls;
  run.tally.countToolCalls(toolCalls.length);
  run.tally.enter("tools");
  const calls = toolCalls.map((call, index) => ({
    call,
    ordinal: first + index + 1,
    prepared: run.parts.tools.prepare(call),
  }));
  return isParallel(calls) ? runParallelBatch(run, calls) : runOrderedBatch(run, calls);
}
