import { BinferenceError } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, moveIntent, nextBlock, readSafely } from "./executor-run.js";
import { sendAndWatch } from "./run-step.js";

/** The steps still waiting for finality, and one a reorg took out of its block, if any. */
interface FinalCheck {
  readonly pending: readonly TransactionRecord[];
  readonly reorged?: TransactionRecord;
}

function moved(id: string): BinferenceError {
  return new BinferenceError({
    code: "engine.transaction_moved",
    message: `Transaction ${id} left the states its block's finality records.`,
  });
}

// A receipt read again, or `failed` when no node answered: the check waits for the next block.
async function readAgain(run: ExecutionRun, step: TransactionRecord) {
  const { plan, signal } = run;
  const read = await readSafely(run, async () => ({
    receipt: await plan.sending.receipts.receipt(plan.chain.ref, step.hash, { signal }),
  }));
  return read === undefined ? "failed" : read.receipt;
}

// A step whose block the head calls final is read again: gone means a reorg took it, another
// block means it moved and waits again there, the same block makes it final. A step that waits
// comes back as it now stands.
async function checkStep(
  run: ExecutionRun,
  step: TransactionRecord,
  final: bigint,
): Promise<"final" | "reorged" | TransactionRecord> {
  const { parts, signal } = run;
  const { transactions } = parts.stores;
  if (step.receipt === undefined || step.receipt.block.number > final) {
    return step;
  }
  const receipt = await readAgain(run, step);
  if (receipt === "failed") {
    return step;
  }
  if (receipt === undefined) {
    return "reorged";
  }
  const atMs = parts.clock.now();
  if (receipt.block.hash !== step.receipt.block.hash) {
    const movedTo = await transactions.recordReceipt({ id: step.id, receipt, atMs }, { signal });
    if (!movedTo.ok) {
      throw moved(step.id);
    }
    return movedTo.value;
  }
  const marked = await transactions.recordFinal({ id: step.id, atMs }, { signal });
  if (!marked.ok) {
    throw moved(step.id);
  }
  return "final";
}

// Steps are checked in order, one at a time; the first one a reorg took stops the check.
async function checkFinal(
  run: ExecutionRun,
  pending: readonly TransactionRecord[],
  final: bigint,
): Promise<FinalCheck> {
  const [step, ...rest] = pending;
  if (step === undefined) {
    return { pending: [] };
  }
  const outcome = await checkStep(run, step, final);
  if (outcome === "reorged") {
    return { pending, reorged: step };
  }
  const after = await checkFinal(run, rest, final);
  return outcome === "final" ? after : { ...after, pending: [outcome, ...after.pending] };
}

// A reorg moves the intent back to `executing`; the same bytes wait for a block again.
async function recoverReorg(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  step: TransactionRecord,
): Promise<{ readonly snapshot: IntentSnapshot; readonly step: TransactionRecord } | undefined> {
  const { parts, signal } = run;
  const intentId = snapshot.record.id;
  const mark = { id: step.id, atMs: parts.clock.now() };
  const back = await parts.stores.transactions.recordReorg(mark, { signal });
  const executing = back.ok ? await moveIntent(run, snapshot, { type: "reorg_seen" }) : undefined;
  if (!back.ok || executing === undefined) {
    return undefined;
  }
  parts.log.warn("executor.reorg_seen", { intentId });
  const watched = await sendAndWatch(run, executing.record, back.value);
  if (watched.outcome === "reverted") {
    await moveIntent(run, executing, { type: "step_reverted" });
    return undefined;
  }
  if (watched.outcome === "stuck") {
    parts.log.warn("executor.step_stopped", { intentId, errorCode: "stuck" });
    return undefined;
  }
  const included = await moveIntent(run, executing, { type: "steps_included" });
  return included === undefined ? undefined : { snapshot: included, step: watched.transaction };
}

/** Where the finality watch stands after a number of waits. */
interface FinalityState {
  readonly snapshot: IntentSnapshot;
  readonly pending: readonly TransactionRecord[];
  readonly waits: number;
}

// One block's check: the head's final block against each step, a reorg's recovery first.
async function checkOnce(
  run: ExecutionRun,
  state: FinalityState,
): Promise<FinalityState | undefined> {
  const { plan, signal } = run;
  const head = await readSafely(run, async () =>
    plan.sending.receipts.head(plan.chain.ref, { signal }),
  );
  const checked =
    head === undefined
      ? { pending: state.pending }
      : await checkFinal(run, state.pending, head.final);
  if (checked.reorged === undefined) {
    return { ...state, pending: checked.pending };
  }
  const recovered = await recoverReorg(run, state.snapshot, checked.reorged);
  if (recovered === undefined) {
    return undefined;
  }
  const pending = checked.pending.map((step) =>
    step.id === recovered.step.id ? recovered.step : step,
  );
  return { ...state, snapshot: recovered.snapshot, pending };
}

async function watchFrom(
  run: ExecutionRun,
  before: FinalityState,
): Promise<IntentSnapshot | undefined> {
  const { parts } = run;
  const intentId = before.snapshot.record.id;
  if (before.waits >= parts.limits.finalAfterBlocks) {
    parts.log.warn("executor.final_late", { intentId });
    return undefined;
  }
  const state = await checkOnce(run, before);
  if (state === undefined) {
    return undefined;
  }
  if (state.pending.length === 0) {
    const finalized = await moveIntent(run, state.snapshot, { type: "finality_reached" });
    parts.log.info("executor.finalized", { intentId });
    return finalized;
  }
  await nextBlock(run);
  return watchFrom(run, { ...state, waits: state.waits + 1 });
}

/**
 * Watches the steps of an intent every block holds until each block is final by the chain's
 * finality rule, then moves the intent to `finalized` and answers it. A reorg that takes a step's
 * block before it is final moves the intent back to `executing` until a block holds the step
 * again. Past `finalAfterBlocks` blocks the watch hands the intent over, still `included`, and
 * answers `undefined`. Pass only the steps not yet `final`.
 */
export async function watchFinality(
  run: ExecutionRun,
  included: IntentSnapshot,
  steps: readonly TransactionRecord[],
): Promise<IntentSnapshot | undefined> {
  return watchFrom(run, { snapshot: included, pending: steps, waits: 0 });
}
