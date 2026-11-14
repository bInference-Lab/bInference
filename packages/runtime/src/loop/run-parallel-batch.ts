import type { BatchCall, BatchEnd } from "./batch-call.js";
import { notRunText } from "./not-run.js";
import { type CallResult, recordResult } from "./record-call.js";
import { recordedRefusal } from "./repaired-calls.js";
import { executeCall } from "./run-tool-call.js";
import { haltOf } from "./turn-halt.js";
import type { TurnRun } from "./turn-run.js";

function refusedResult(text: string): CallResult {
  return { text, isError: true, outside: false, ran: false };
}

// A refused call as the batch records it, a held one counted toward the turn's most (decision
// 0447), before any call is written.
function asRecorded(run: TurnRun, item: BatchCall): BatchCall {
  if (item.prepared.ready) {
    return item;
  }
  const { call, text } = recordedRefusal(run, item.call, item.prepared);
  return { ...item, call, prepared: { ...item.prepared, text } };
}

// A halted turn starts none of the batch's reads.
async function settle(run: TurnRun, item: BatchCall): Promise<CallResult> {
  const { prepared } = item;
  if (!prepared.ready) {
    return refusedResult(prepared.text);
  }
  if (run.halted.aborted) {
    return refusedResult(notRunText(haltOf(run.halted)));
  }
  // Only a control tool (`ask_owner`) ends a turn, and a parallel batch holds reads alone.
  return (await executeCall(run, item, prepared)).result;
}

/**
 * Runs a batch of reads that allow it side by side (runtime spec, section 5.3): every call is
 * written first, then all run, and their results are written in the model's order once all
 * returned. A parallel batch is never cut by a merge; its merge point comes after it.
 */
export async function runParallelBatch(
  run: TurnRun,
  batch: readonly BatchCall[],
): Promise<BatchEnd> {
  const calls = batch.map((item) => asRecorded(run, item));
  for (const item of calls) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- calls are written in the model's order
    await run.parts.journal.toolCall(item.call, run.writes);
  }
  const results = await Promise.all(calls.map(async (item) => settle(run, item)));
  for (const [index, item] of calls.entries()) {
    const result = results[index] ?? refusedResult(notRunText("runtime"));
    // oxlint-disable-next-line eslint/no-await-in-loop -- results keep the calls' order
    await recordResult(run, item.call, result);
  }
  return { askedOwner: false, joined: [], reachedLimit: false };
}
