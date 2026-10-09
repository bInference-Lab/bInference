import { accountRefParts, type TxReceipt } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { noticePush } from "../pushes/notice-push.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, moveIntent, nextBlock, readSafely } from "./executor-run.js";
import { recordReceipt, sendOnce } from "./run-step.js";

/**
 * What the chain shows of a stored step that no receipt was recorded for (spec 6, section 7): a
 * block holds it, its nonce is still free, or another transaction used its nonce.
 */
export type StepFate =
  | { readonly kind: "found"; readonly receipt: TxReceipt }
  | { readonly kind: "free" }
  | { readonly kind: "taken" };

/** A step whose fate is known: the intent as it now stands, and the step's transaction. */
export interface KnownStep {
  readonly snapshot: IntentSnapshot;
  readonly transaction: TransactionRecord;
}

// The owner's alarm when another transaction used a step's nonce (spec 4, section 4).
const unknownTxNoticeKey = "notice.unknownTx";

// The count is read before the receipt: a block that takes the step between the two reads shows
// in the receipt, so a used nonce with no receipt is never the step's own.
async function readFate(
  run: ExecutionRun,
  transaction: TransactionRecord,
): Promise<StepFate | undefined> {
  const { plan, signal } = run;
  const { receipts } = plan.sending;
  return readSafely(run, async () => {
    const head = await receipts.head(plan.chain.ref, { signal });
    const used = await receipts.nonceAt(transaction.account, head.latest, { signal });
    const receipt = await receipts.receipt(plan.chain.ref, transaction.hash, { signal });
    if (receipt !== undefined) {
      return { kind: "found", receipt } as const;
    }
    return used > transaction.nonce ? ({ kind: "taken" } as const) : ({ kind: "free" } as const);
  });
}

/**
 * Reads a step's fate, again each block while no node answers, up to three times
 * `stuckAfterBlocks` blocks; `undefined` once that runs out.
 */
export async function fateOf(
  run: ExecutionRun,
  transaction: TransactionRecord,
  waits = 0,
): Promise<StepFate | undefined> {
  const fate = await readFate(run, transaction);
  if (fate !== undefined || waits >= run.parts.limits.stuckAfterBlocks * 3) {
    return fate;
  }
  await nextBlock(run);
  return fateOf(run, transaction, waits + 1);
}

// Whether a final block holds the step's nonce: then the step can never be included.
async function isTakenForGood(run: ExecutionRun, transaction: TransactionRecord) {
  const { plan, signal } = run;
  const { receipts } = plan.sending;
  const final = await readSafely(run, async () => {
    const head = await receipts.head(plan.chain.ref, { signal });
    return receipts.nonceAt(transaction.account, head.final, { signal });
  });
  return final !== undefined && final > transaction.nonce;
}

async function failNonceTaken(
  run: ExecutionRun,
  unknown: IntentSnapshot,
  transaction: TransactionRecord,
): Promise<void> {
  const { record } = unknown;
  const failed = await moveIntent(run, unknown, { type: "nonce_taken" });
  if (failed === undefined) {
    return;
  }
  run.parts.log.error("executor.nonce_taken", { intentId: record.id, chain: run.plan.chain.ref });
  const wallet = accountRefParts(transaction.account).address;
  const values = { wallet, nonce: String(transaction.nonce) };
  const notice = { key: unknownTxNoticeKey, agent: record.agentId, intent: record.id, values };
  run.parts.publish(noticePush(notice));
}

/** Where the reconciliation of a step whose fate is unknown stands. */
interface UnknownState {
  readonly unknown: IntentSnapshot;
  readonly transaction: TransactionRecord;
  readonly waits: number;
}

// One block's check: the step in a block is the wallet's own after all; a nonce a final block
// holds without it is another's; a free nonce gets the same bytes again, which only the step uses.
async function checkUnknown(
  run: ExecutionRun,
  state: UnknownState,
): Promise<KnownStep | "failed" | "waiting"> {
  const { unknown, transaction } = state;
  const fate = await readFate(run, transaction);
  if (fate?.kind === "found") {
    const recorded = await recordReceipt(run, transaction, fate.receipt);
    const executing = await moveIntent(run, unknown, { type: "sent_step_found" });
    return executing === undefined
      ? "failed"
      : { snapshot: executing, transaction: recorded.transaction };
  }
  if (fate?.kind === "free" && state.waits < run.parts.limits.sendAttempts) {
    await sendOnce(run, unknown.record, transaction);
  }
  if (fate?.kind === "taken" && (await isTakenForGood(run, transaction))) {
    await failNonceTaken(run, unknown, transaction);
    return "failed";
  }
  return "waiting";
}

/**
 * Reconciles a step of an intent in `unknown_after_send` (spec 6, section 7), each block until
 * its fate is known: a block holds the step, so the intent goes back to `executing` with the
 * step's receipt recorded; or a final block holds its nonce without it, so the intent ends
 * `failed_onchain` with `nonce_taken` and an alarm notice. Nothing is signed. Past
 * `finalAfterBlocks` blocks it leaves the intent unknown and logs it.
 */
export async function reconcileUnknown(
  run: ExecutionRun,
  state: UnknownState,
): Promise<KnownStep | undefined> {
  const checked = await checkUnknown(run, state);
  if (checked === "failed") {
    return undefined;
  }
  if (checked !== "waiting") {
    return checked;
  }
  if (state.waits >= run.parts.limits.finalAfterBlocks) {
    run.parts.log.warn("executor.unknown_late", { intentId: state.unknown.record.id });
    return undefined;
  }
  await nextBlock(run);
  return reconcileUnknown(run, { ...state, waits: state.waits + 1 });
}
