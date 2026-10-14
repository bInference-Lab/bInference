import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { fillOrderOf } from "../orders/fill-ends.js";
import { holdingStates, inBlockStates } from "../wallet-queue/lowest-free-nonce.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { WalletSlot } from "../wallet-queue/wallet-slot.js";
import { endDropped } from "./end-dropped.js";
import { endUnsent } from "./end-unsent.js";
import { finishFill, type IncludedSteps } from "./execute-in-slot.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import { recoveredFillTerms } from "./queue-check.js";
import { recordReceipt, sendOnce } from "./run-step.js";
import { sendAndWatch } from "./send-and-watch.js";
import {
  fateOf,
  type KnownStep,
  type NonceTransactions,
  reconcileUnknown,
  rivalsOf,
} from "./step-fate.js";
import type { DroppedStep } from "./watch-dropped.js";

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

// A step the chain holds goes on; one that reverted, or whose cancel landed, ends the intent, and
// no later step is sent.
async function goOn(run: ExecutionRun, known: KnownStep): Promise<KnownStep | undefined> {
  const isCancel = known.transaction.replaces?.kind === "cancel";
  if (!isCancel && known.transaction.state !== "reverted") {
    return known;
  }
  await moveIntent(run, known.snapshot, { type: isCancel ? "step_cancelled" : "step_reverted" });
  return undefined;
}

/** A step recovery reads: the intent as it stands, and the step's transactions at its nonce. */
interface RecoveringStep extends NonceTransactions {
  readonly snapshot: IntentSnapshot;
}

// A stored step no receipt was recorded for: a block holds one of its transactions, its nonce is
// free and the same bytes go again, or another transaction used its nonce and its fate is unknown
// until a final block says whose it is (spec 6, section 7). Nothing is signed.
async function settleSent(
  run: ExecutionRun,
  step: RecoveringStep,
): Promise<KnownStep | DroppedStep | undefined> {
  const { snapshot, transaction, rivals } = step;
  const fate = await fateOf(run, step);
  if (fate === undefined) {
    return stopped(run, snapshot, "chain_unread");
  }
  if (fate.kind === "found") {
    const recorded = await recordReceipt(run, fate.transaction, fate.receipt);
    return goOn(run, { snapshot, transaction: recorded });
  }
  if (fate.kind === "free") {
    const intent = snapshot.record;
    const { transaction: resent } = await sendOnce(run, intent, transaction);
    const watched = await sendAndWatch(run, { intent, transaction: resent, rivals });
    if (watched.outcome === "dropped") {
      return endDropped(run, snapshot, watched.transaction);
    }
    return watched.outcome === "stuck"
      ? stopped(run, snapshot, watched.problem)
      : goOn(run, { snapshot, transaction: watched.transaction });
  }
  const unknown = await moveIntent(run, snapshot, { type: "fate_unknown" });
  return unknown === undefined ? undefined : settleUnknown(run, { ...step, snapshot: unknown });
}

async function settleUnknown(
  run: ExecutionRun,
  step: RecoveringStep,
): Promise<KnownStep | undefined> {
  const { snapshot: unknown, transaction, rivals } = step;
  run.parts.log.warn("executor.fate_unknown", { intentId: unknown.record.id });
  const known = await reconcileUnknown(run, { unknown, transaction, rivals, waits: 0 });
  return known === undefined ? undefined : goOn(run, known);
}

// A step a block holds goes on as it is; the step with no receipt is the one whose fate decides.
async function settleStep(
  run: ExecutionRun,
  step: RecoveringStep,
): Promise<KnownStep | DroppedStep | undefined> {
  const { snapshot, transaction } = step;
  if (inBlockStates.includes(transaction.state)) {
    return goOn(run, step);
  }
  if (!holdingStates.includes(transaction.state)) {
    return stopped(run, snapshot, "replaced_step");
  }
  return snapshot.record.state === "unknown_after_send"
    ? settleUnknown(run, step)
    : settleSent(run, step);
}

/** Where recovery stands in an intent's steps: the steps settled so far, the next one's index. */
interface Walk {
  readonly slot: WalletSlot;
  readonly snapshot: IntentSnapshot;
  readonly stored: readonly TransactionRecord[];
  readonly steps: ReadonlyMap<number, TransactionRecord>;
  readonly index: number;
  readonly done: readonly TransactionRecord[];
}

// A step with no current transaction: one never signed ends the intent. One whose transactions
// were all replaced or dropped goes on when a block holds one of them after all, ends once one
// was dropped (decision 0115), and is left as it is otherwise.
async function settleMissing(
  run: ExecutionRun,
  walk: Walk,
): Promise<KnownStep | DroppedStep | undefined> {
  const { snapshot, index } = walk;
  const [last, ...earlier] = walk.stored.filter(({ step }) => step === index).toReversed();
  if (last === undefined) {
    return endUnsentAfterReset(run, walk);
  }
  const fate = await fateOf(run, { transaction: last, rivals: earlier });
  if (fate?.kind === "found") {
    const recorded = await recordReceipt(run, fate.transaction, fate.receipt);
    return goOn(run, { snapshot, transaction: recorded });
  }
  const dropped = [last, ...earlier].find(({ state }) => state === "dropped");
  return dropped === undefined
    ? stopped(run, snapshot, "replaced_step")
    : endDropped(run, snapshot, dropped);
}

// A step never signed ends the intent; a reset of its fill's approval stored after the plan's
// steps goes on first from what the chain shows, its stored bytes sent again, so its nonce is
// never left unsent (decision 0211). Nothing is signed.
async function endUnsentAfterReset(
  run: ExecutionRun,
  walk: Walk,
): Promise<KnownStep | DroppedStep | undefined> {
  const { snapshot, index } = walk;
  const reset = walk.steps.get(run.plan.steps.length);
  if (reset === undefined || inBlockStates.includes(reset.state)) {
    return endUnsent(run, snapshot, index);
  }
  const rivals = rivalsOf(walk.stored, reset);
  const settled = await settleStep(run, { snapshot, transaction: reset, rivals });
  if (settled === undefined || "dropped" in settled) {
    return settled;
  }
  return endUnsent(run, settled.snapshot, index);
}

// Whether recovery goes on with a live fill's later step a stop left unsigned: an earlier step
// landed, and no reset of its approval was stored, which only a lapsed grant makes.
function goesOnWithFill(run: ExecutionRun, walk: Walk): boolean {
  const { snapshot, steps, index } = walk;
  const isLiveFill = !snapshot.record.isPaper && fillOrderOf(snapshot) !== undefined;
  return isLiveFill && index > 0 && !steps.has(index) && !steps.has(run.plan.steps.length);
}

// A live fill's later steps go on under its grant, as its first run would have (decision 0211);
// a fill whose stored terms no longer bind it ends unsent, signing nothing.
async function goOnWithFill(
  run: ExecutionRun,
  walk: Walk,
): Promise<IncludedSteps | DroppedStep | undefined> {
  const { snapshot, index, done, slot } = walk;
  const context = { parts: run.parts, chain: run.plan.chain };
  const terms = await recoveredFillTerms(snapshot, context, run.signal);
  return terms === undefined
    ? endUnsent(run, snapshot, index)
    : finishFill(run, slot, { snapshot, terms, index, done });
}

async function walkFrom(
  run: ExecutionRun,
  walk: Walk,
): Promise<IncludedSteps | DroppedStep | undefined> {
  const { snapshot, steps, index, done } = walk;
  if (index === run.plan.steps.length) {
    const included = await moveIntent(run, snapshot, { type: "steps_included" });
    return included === undefined ? undefined : { included, steps: done };
  }
  if (goesOnWithFill(run, walk)) {
    return goOnWithFill(run, walk);
  }
  const transaction = steps.get(index);
  const known =
    transaction === undefined
      ? await settleMissing(run, walk)
      : await settleStep(run, {
          snapshot,
          transaction,
          rivals: rivalsOf(walk.stored, transaction),
        });
  if (known === undefined || "dropped" in known) {
    return known;
  }
  const next = { ...walk, snapshot: known.snapshot, index: index + 1 };
  return walkFrom(run, { ...next, done: [...done, known.transaction] });
}

/**
 * Recovers an intent a restart left `executing` or `unknown_after_send` (spec 6, section 7), on
 * its wallet's queue: each step's stored transaction in turn is looked up by hash and nonce and
 * goes on from what the chain shows; nothing is signed but a live fill's later step, as follows.
 * It answers the included steps once every step is in a block, whichever of a step's transactions at its nonce landed. A step
 * whose cancel landed ends the intent `failed_onchain` with `stuck_cancelled`; one every relay
 * refused for `droppedAfterBlocks` blocks, or one recorded dropped before the stop, ends it with
 * `stuck_dropped` (decision 0115), and the dropped step comes back to be watched off the queue; a
 * step never signed ends it (decision 0109), except a live fill's later step, which goes on under
 * its grant or resets the approval its landed steps left (decision 0211). A step that stays
 * stuck, since recovery never replaces one, whose transactions were all replaced, or whose fate
 * stays unknown stops the recovery and leaves the intent where it is, logged.
 */
export async function recoverSteps(
  run: ExecutionRun,
  slot: WalletSlot,
  recovering: { readonly snapshot: IntentSnapshot; readonly stored: readonly TransactionRecord[] },
): Promise<IncludedSteps | DroppedStep | undefined> {
  const { snapshot, stored } = recovering;
  const steps = currentSteps(stored);
  return walkFrom(run, { slot, snapshot, stored, steps, index: 0, done: [] });
}
