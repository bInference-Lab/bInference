import type { BatchCall, BatchEnd } from "./batch-call.js";
import { canMerge } from "./can-merge.js";
import type { OwnerMessage } from "./model-message.js";
import type { NotRunReason } from "./not-run.js";
import { recordNotRun, recordRefused } from "./record-call.js";
import { runProposal, runToolCall } from "./run-tool-call.js";
import { haltOf } from "./turn-halt.js";
import type { ReadyCall } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

/** Where an ordered batch is: what joined, and whether a model call can follow it at all. */
interface OrderedState {
  readonly joined: readonly OwnerMessage[];
  /** A call asked the owner, or a call of the batch is past the limit: the turn ends after it. */
  readonly ends: boolean;
}

// Merge point 1 (runtime spec, section 3.4): before each call but the first, waiting messages
// join and the calls not started yet do not run, when a model call can follow to answer them.
async function joinedBefore(
  run: TurnRun,
  index: number,
  state: OrderedState,
): Promise<readonly OwnerMessage[]> {
  if (state.joined.length > 0 || index === 0 || state.ends || !canMerge(run)) {
    return state.joined;
  }
  return run.parts.merge.take(run.writes);
}

function skipReason(run: TurnRun, joined: readonly OwnerMessage[]): NotRunReason | undefined {
  if (run.halted.aborted) {
    return haltOf(run.halted);
  }
  return joined.length > 0 ? "merge" : undefined;
}

// One proposal per turn (decision 0167): the first propose call that passed its check runs, and
// every later one in the batch is held back and counted.
async function proposeOrHoldBack(run: TurnRun, item: BatchCall, ready: ReadyCall): Promise<void> {
  if (run.tally.now().committed) {
    run.tally.holdBack();
    await recordNotRun(run, item.call, "held_back");
    return;
  }
  await runProposal(run, item, ready);
}

// A batch with a proposal that passed its check: its card asks the owner, so no question runs
// beside it (decision 0173).
function hasProposal(calls: readonly BatchCall[]): boolean {
  return calls.some(({ prepared }) => prepared.ready && prepared.kind === "propose");
}

// Runs one call that is not skipped; answers whether its tool asked to end the turn.
async function runOne(
  run: TurnRun,
  item: BatchCall,
  batch: { readonly proposes: boolean },
): Promise<boolean> {
  const { prepared } = item;
  if (!prepared.ready) {
    await recordRefused(run, item.call, prepared.text);
    return false;
  }
  if (prepared.asksOwner && (batch.proposes || run.tally.now().committed)) {
    await recordNotRun(run, item.call, "card_asks");
    return false;
  }
  if (prepared.kind === "propose") {
    await proposeOrHoldBack(run, item, prepared);
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
  options: { readonly overLimit: boolean },
): Promise<BatchEnd> {
  let joined: readonly OwnerMessage[] = [];
  let askedOwner = false;
  const batch = { proposes: hasProposal(calls) };
  for (const [index, item] of calls.entries()) {
    const state = { joined, ends: askedOwner || options.overLimit };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each call starts after the one before
    joined = await joinedBefore(run, index, state);
    const reason = skipReason(run, joined);
    if (reason === undefined) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each call starts after the one before
      askedOwner = (await runOne(run, item, batch)) || askedOwner;
    } else {
      // oxlint-disable-next-line eslint/no-await-in-loop -- results keep the calls' order
      await recordNotRun(run, item.call, reason);
    }
  }
  return { askedOwner, joined, reachedLimit: false };
}
