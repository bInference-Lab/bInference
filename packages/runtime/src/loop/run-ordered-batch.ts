import type { BatchCall, BatchEnd } from "./batch-call.js";
import type { OwnerMessage } from "./model-message.js";
import type { NotRunReason } from "./not-run.js";
import { recordNotRun, recordRefused } from "./record-call.js";
import { runProposal, runToolCall } from "./run-tool-call.js";
import { haltOf } from "./turn-halt.js";
import type { TurnRun } from "./turn-run.js";

// Merge point 1 (runtime spec, section 3.4): before each call but the first, while the turn is
// neither committed nor halted, waiting messages join and the calls not started yet do not run.
async function joinedBefore(
  run: TurnRun,
  index: number,
  joined: readonly OwnerMessage[],
): Promise<readonly OwnerMessage[]> {
  if (joined.length > 0 || index === 0 || run.tally.now().committed || run.halted.aborted) {
    return joined;
  }
  return run.parts.merge.take(run.writes);
}

function skipReason(run: TurnRun, joined: readonly OwnerMessage[]): NotRunReason | undefined {
  if (run.halted.aborted) {
    return haltOf(run.halted);
  }
  return joined.length > 0 ? "merge" : undefined;
}

// Runs one call that is not skipped; answers whether its tool asked to end the turn.
async function runOne(run: TurnRun, item: BatchCall): Promise<boolean> {
  const { prepared } = item;
  if (!prepared.ready) {
    await recordRefused(run, item.call, prepared.text);
    return false;
  }
  if (prepared.kind === "propose") {
    await runProposal(run, item, prepared);
    return false;
  }
  return runToolCall(run, item, prepared);
}

/**
 * Runs a batch's calls one at a time, in the model's order (runtime spec, section 5.3). Each call
 * is written before it runs and its result after; a call that a merge or a halt keeps from running
 * gets its "not run" result, so the transcript stays whole.
 */
export async function runOrderedBatch(
  run: TurnRun,
  calls: readonly BatchCall[],
): Promise<BatchEnd> {
  let joined: readonly OwnerMessage[] = [];
  let askedOwner = false;
  for (const [index, item] of calls.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each call starts after the one before
    joined = await joinedBefore(run, index, joined);
    const reason = skipReason(run, joined);
    if (reason === undefined) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each call starts after the one before
      askedOwner = (await runOne(run, item)) || askedOwner;
    } else {
      // oxlint-disable-next-line eslint/no-await-in-loop -- results keep the calls' order
      await recordNotRun(run, item.call, reason);
    }
  }
  return { askedOwner, joined };
}
