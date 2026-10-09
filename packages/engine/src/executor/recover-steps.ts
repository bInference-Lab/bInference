import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { holdingStates, inBlockStates } from "../wallet-queue/lowest-free-nonce.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { endUnsent } from "./end-unsent.js";
import type { IncludedSteps } from "./execute-in-slot.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import { recordReceipt, sendAndWatch, sendOnce } from "./run-step.js";
import { fateOf, type KnownStep, reconcileUnknown } from "./step-fate.js";

/**
 * Each step's transaction as recovery reads it: the last one stored for the step that a later
 * transaction did not replace and that was not dropped, by step.
 */
export function currentSteps(
  stored: readonly TransactionRecord[],
): ReadonlyMap<number, TransactionRecord> {
  const live = stored.filter(({ state }) => state !== "superseded" && state !== "dropped");
  return new Map(live.map((transaction) => [transaction.step, transaction]));
}

function stopped(run: ExecutionRun, snapshot: IntentSnapshot, problem: string): undefined {
  run.parts.log.warn("executor.step_stopped", { intentId: snapshot.record.id, errorCode: problem });
  return undefined;
}

// A step the chain holds goes on; one that reverted ends the intent, and no later step is sent.
async function goOn(run: ExecutionRun, known: KnownStep): Promise<KnownStep | undefined> {
  if (known.transaction.state !== "reverted") {
    return known;
  }
  await moveIntent(run, known.snapshot, { type: "step_reverted" });
  return undefined;
}

// A stored step no receipt was recorded for: a block holds it, its nonce is free and the same
// bytes go again, or another transaction used its nonce and its fate is unknown until a final
// block says whose it is (spec 6, section 7). Nothing is signed.
async function settleSent(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  transaction: TransactionRecord,
): Promise<KnownStep | undefined> {
  const fate = await fateOf(run, transaction);
  if (fate === undefined) {
    return stopped(run, snapshot, "chain_unread");
  }
  if (fate.kind === "found") {
    const recorded = await recordReceipt(run, transaction, fate.receipt);
    return goOn(run, { snapshot, transaction: recorded.transaction });
  }
  if (fate.kind === "free") {
    const resent = await sendOnce(run, snapshot.record, transaction);
    const watched = await sendAndWatch(run, snapshot.record, resent);
    return watched.outcome === "stuck"
      ? stopped(run, snapshot, "stuck")
      : goOn(run, { snapshot, transaction: watched.transaction });
  }
  const unknown = await moveIntent(run, snapshot, { type: "fate_unknown" });
  return unknown === undefined ? undefined : settleUnknown(run, { snapshot: unknown, transaction });
}

async function settleUnknown(run: ExecutionRun, step: KnownStep): Promise<KnownStep | undefined> {
  const { snapshot: unknown, transaction } = step;
  run.parts.log.warn("executor.fate_unknown", { intentId: unknown.record.id });
  const known = await reconcileUnknown(run, { unknown, transaction, waits: 0 });
  return known === undefined ? undefined : goOn(run, known);
}

// A step a block holds goes on as it is; the step with no receipt is the one whose fate decides.
async function settleStep(run: ExecutionRun, step: KnownStep): Promise<KnownStep | undefined> {
  const { snapshot, transaction } = step;
  if (inBlockStates.includes(transaction.state)) {
    return goOn(run, step);
  }
  if (!holdingStates.includes(transaction.state)) {
    return stopped(run, snapshot, "replaced_step");
  }
  return snapshot.record.state === "unknown_after_send"
    ? settleUnknown(run, step)
    : settleSent(run, snapshot, transaction);
}

/** Where recovery stands in an intent's steps: the steps settled so far, the next one's index. */
interface Walk {
  readonly snapshot: IntentSnapshot;
  readonly stored: readonly TransactionRecord[];
  readonly steps: ReadonlyMap<number, TransactionRecord>;
  readonly index: number;
  readonly done: readonly TransactionRecord[];
}

// A step with no current transaction: one never signed ends the intent; one whose transactions
// were all replaced or dropped waits for the stuck step's handling.
async function settleMissing(run: ExecutionRun, walk: Walk): Promise<undefined> {
  const isReplaced = walk.stored.some(({ step }) => step === walk.index);
  return isReplaced
    ? stopped(run, walk.snapshot, "replaced_step")
    : endUnsent(run, walk.snapshot, walk.index);
}

async function walkFrom(run: ExecutionRun, walk: Walk): Promise<IncludedSteps | undefined> {
  const { snapshot, steps, index, done } = walk;
  if (index === run.plan.steps.length) {
    const included = await moveIntent(run, snapshot, { type: "steps_included" });
    return included === undefined ? undefined : { included, steps: done };
  }
  const transaction = steps.get(index);
  if (transaction === undefined) {
    return settleMissing(run, walk);
  }
  const known = await settleStep(run, { snapshot, transaction });
  if (known === undefined) {
    return undefined;
  }
  const next = { ...walk, snapshot: known.snapshot, index: index + 1 };
  return walkFrom(run, { ...next, done: [...done, known.transaction] });
}

/**
 * Recovers an intent a restart left `executing` or `unknown_after_send` (spec 6, section 7), on
 * its wallet's queue: each step's stored transaction in turn is looked up by hash and nonce and
 * goes on from what the chain shows, and nothing is ever signed. It answers the included steps
 * once every step is in a block. A step never signed ends the intent (decision 0109). A step that
 * stays stuck, whose transactions were replaced or dropped, or whose fate stays unknown stops the
 * recovery and leaves the intent where it is, logged.
 */
export async function recoverSteps(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  stored: readonly TransactionRecord[],
): Promise<IncludedSteps | undefined> {
  const steps = currentSteps(stored);
  return walkFrom(run, { snapshot, stored, steps, index: 0, done: [] });
}
