import { accountRefParts, type TxReceipt } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { noticePush } from "../pushes/notice-push.js";
import { holdingStates } from "../wallet-queue/lowest-free-nonce.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, moveIntent, nextBlock, readSafely } from "./executor-run.js";
import { recordReceipt, sendOnce } from "./run-step.js";

/**
 * What the chain shows of a stored step that no receipt was recorded for (spec 6, section 7): a
 * block holds one of its transactions at its nonce, the nonce is still free, or a transaction
 * that is none of them used the nonce.
 */
export type StepFate =
  | {
      readonly kind: "found";
      readonly transaction: TransactionRecord;
      readonly receipt: TxReceipt;
    }
  | { readonly kind: "free" }
  | { readonly kind: "taken" };

/**
 * A step's transactions at its nonce: the one it stands on now, then those it replaced (spec 6,
 * section 6), any of which a block may hold.
 */
export interface NonceTransactions {
  readonly transaction: TransactionRecord;
  readonly rivals: readonly TransactionRecord[];
}

/** The step's other stored transactions at the nonce of `transaction`. */
export function rivalsOf(
  stored: readonly TransactionRecord[],
  transaction: TransactionRecord,
): readonly TransactionRecord[] {
  return stored.filter(
    ({ id, step, nonce }) =>
      id !== transaction.id && step === transaction.step && nonce === transaction.nonce,
  );
}

/** The first of the transactions a block holds, with its receipt; `undefined` while none. */
export async function landedOf(
  run: ExecutionRun,
  at: NonceTransactions,
): Promise<{ readonly transaction: TransactionRecord; readonly receipt: TxReceipt } | undefined> {
  const { plan, signal } = run;
  const all = [at.transaction, ...at.rivals];
  const receipts = await Promise.all(
    all.map(async ({ hash }) => plan.sending.receipts.receipt(plan.chain.ref, hash, { signal })),
  );
  const index = receipts.findIndex((receipt) => receipt !== undefined);
  const transaction = all[index];
  const receipt = receipts[index];
  return transaction === undefined || receipt === undefined ? undefined : { transaction, receipt };
}

/** A step whose fate is known: the intent as it now stands, and the step's transaction. */
export interface KnownStep {
  readonly snapshot: IntentSnapshot;
  readonly transaction: TransactionRecord;
}

// The owner's alarm when another transaction used a step's nonce (spec 4, section 4).
const unknownTxNoticeKey = "notice.unknownTx";

/**
 * Reads a step's fate once; `undefined` when no node answers. The count is read before the
 * receipts: a block that takes the step between the reads shows in a receipt, so a used nonce
 * with no receipt is never the step's own.
 */
export async function readFate(
  run: ExecutionRun,
  at: NonceTransactions,
): Promise<StepFate | undefined> {
  const { plan, signal } = run;
  const { receipts } = plan.sending;
  const { account, nonce } = at.transaction;
  return readSafely(run, async () => {
    const head = await receipts.head(plan.chain.ref, { signal });
    const used = await receipts.nonceAt(account, head.latest, { signal });
    const landed = await landedOf(run, at);
    if (landed !== undefined) {
      return { kind: "found", ...landed } as const;
    }
    return used > nonce ? ({ kind: "taken" } as const) : ({ kind: "free" } as const);
  });
}

/**
 * Reads a step's fate, again each block while no node answers, up to three times
 * `stuckAfterBlocks` blocks; `undefined` once that runs out.
 */
export async function fateOf(
  run: ExecutionRun,
  at: NonceTransactions,
  waits = 0,
): Promise<StepFate | undefined> {
  const fate = await readFate(run, at);
  if (fate !== undefined || waits >= run.parts.limits.stuckAfterBlocks * 3) {
    return fate;
  }
  await nextBlock(run);
  return fateOf(run, at, waits + 1);
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

// Another transaction took the nonce for good: the step's own there are superseded.
async function failNonceTaken(
  run: ExecutionRun,
  unknown: IntentSnapshot,
  at: NonceTransactions,
): Promise<void> {
  const { record } = unknown;
  const { transaction } = at;
  const failed = await moveIntent(run, unknown, { type: "nonce_taken" });
  if (failed === undefined) {
    return;
  }
  const { parts, signal } = run;
  const holding = [transaction, ...at.rivals].filter(({ state }) => holdingStates.includes(state));
  await Promise.all(
    holding.map(async ({ id }) =>
      parts.stores.transactions.recordSuperseded({ id, atMs: parts.clock.now() }, { signal }),
    ),
  );
  run.parts.log.error("executor.nonce_taken", { intentId: record.id, chain: run.plan.chain.ref });
  const wallet = accountRefParts(transaction.account).address;
  const values = { wallet, nonce: String(transaction.nonce) };
  const notice = { key: unknownTxNoticeKey, agent: record.agentId, intent: record.id, values };
  run.parts.publish(noticePush(notice));
}

/** Where the reconciliation of a step whose fate is unknown stands. */
interface UnknownState extends NonceTransactions {
  readonly unknown: IntentSnapshot;
  readonly waits: number;
}

// One block's check: a step's transaction in a block is the wallet's own after all; a nonce a
// final block holds without any of them is another's; a free nonce gets the same bytes again,
// which only the step uses.
async function checkUnknown(
  run: ExecutionRun,
  state: UnknownState,
): Promise<KnownStep | "failed" | "waiting"> {
  const { unknown, transaction } = state;
  const fate = await readFate(run, state);
  if (fate?.kind === "found") {
    const recorded = await recordReceipt(run, fate.transaction, fate.receipt);
    const executing = await moveIntent(run, unknown, { type: "sent_step_found" });
    return executing === undefined ? "failed" : { snapshot: executing, transaction: recorded };
  }
  if (fate?.kind === "free" && state.waits < run.parts.limits.sendAttempts) {
    await sendOnce(run, unknown.record, transaction);
  }
  if (fate?.kind === "taken" && (await isTakenForGood(run, transaction))) {
    await failNonceTaken(run, unknown, state);
    return "failed";
  }
  return "waiting";
}

/**
 * Reconciles a step of an intent in `unknown_after_send` (spec 6, section 7), each block until
 * its fate is known: a block holds one of the step's transactions, so the intent goes back to
 * `executing` with that receipt recorded; or a final block holds its nonce without any of them,
 * so the intent ends `failed_onchain` with `nonce_taken` and an alarm notice, and the step's
 * transactions are superseded. Nothing is signed. Past
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
