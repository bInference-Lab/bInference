import type { ChainHead, PreparedTx, TxDraft, TxReceipt } from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { WalletSlot } from "../wallet-queue/wallet-slot.js";
import { type ExecutionRun, nextBlock, readSafely } from "./executor-run.js";
import type { SigningTerms } from "./queue-check.js";
import { signRequestOf } from "./step-request.js";
import { recordStepSent } from "./step-sent.js";

/** A step's draft at the nonce its slot gave, ready to sign. */
export interface PreparedStep {
  readonly index: number;
  readonly draft: TxDraft;
  readonly nonce: number;
  readonly prepared: PreparedTx;
}

/** Why a step was not signed, or not stored once signed: nothing was sent for it. */
export type SignStop =
  | "would_fail"
  | "refused"
  | "unknown_wallet"
  | "bad_signature"
  | "nonce_taken";

/** How the watch of a sent step ended. */
export interface Watched {
  readonly outcome: "included" | "reverted" | "stuck";
  readonly transaction: TransactionRecord;
}

/** Takes the next nonce from the slot and prepares the step's draft at it, read from the chain. */
export async function prepareStep(
  run: ExecutionRun,
  slot: WalletSlot,
  step: { readonly index: number; readonly draft: TxDraft },
): Promise<Result<PreparedStep, "would_fail">> {
  const { signal, plan } = run;
  const { index, draft } = step;
  const { nonce } = await slot.nextNonce({ signal });
  const prepared = await plan.sending.preparer.prepare({ draft, nonce }, { signal });
  return prepared.ok ? ok({ index, draft, nonce, prepared: prepared.value }) : prepared;
}

/**
 * Signs a prepared step through custody with what authorized the intent, checks that the signed
 * bytes are the step's own through the chain's signing scheme, and stores them in the slot before
 * anything is sent (ARCHITECTURE.md rule 6).
 */
export async function signAndStore(
  run: ExecutionRun,
  slot: WalletSlot,
  step: {
    readonly record: IntentRecord;
    readonly terms: SigningTerms;
    readonly ready: PreparedStep;
  },
): Promise<Result<TransactionRecord, SignStop>> {
  const { parts, plan, signal } = run;
  const { record, terms, ready } = step;
  const { index, draft, nonce, prepared } = ready;
  const { unsigned } = prepared;
  const request = signRequestOf({ record, chain: plan.chain, terms, index, draft, unsigned });
  const signed = await parts.custody.signTransaction(request, { signal });
  if (!signed.ok) {
    return signed;
  }
  const hash = plan.chain.signingScheme.verify(unsigned, signed.value);
  if (!hash.ok) {
    return err("bad_signature");
  }
  const transaction = {
    id: parts.ids.next("tx"),
    intentId: record.id,
    step: index,
    account: slot.account,
    nonce,
    raw: signed.value.raw,
    hash: hash.value,
    signedAtMs: parts.clock.now(),
  };
  const saved = await slot.saveSigned(transaction, { signal });
  return saved.ok ? saved : err("nonce_taken");
}

/**
 * One send of a stored transaction's bytes to every relay, each answer recorded. An acceptance
 * moves a `signed` step to `sent` and records the send in the ledger. Nothing is signed.
 */
export async function sendOnce(
  run: ExecutionRun,
  intent: IntentRecord,
  transaction: TransactionRecord,
): Promise<TransactionRecord> {
  const { parts, plan, signal } = run;
  const stored = { chain: plan.chain.ref, raw: transaction.raw };
  const answers = await plan.sending.sender.send(stored, { signal });
  const recorded = await parts.stores.transactions.recordSend(
    { id: transaction.id, answers },
    { signal },
  );
  if (!recorded.ok) {
    throw new BinferenceError({
      code: "engine.transaction_moved",
      message: `Transaction ${transaction.id} left the states a send records.`,
      details: { intent: intent.id },
    });
  }
  const intentId = intent.id;
  const accepted = answers.filter(({ outcome }) => outcome === "accepted");
  if (accepted.length > 0) {
    parts.log.info("executor.sent", { intentId, chain: plan.chain.ref });
    const relays = accepted.map(({ relay }) => relay);
    await recordStepSent(run, intent, { transaction: recorded.value, relays });
  } else {
    parts.log.warn("executor.send_failed", { intentId, chain: plan.chain.ref });
  }
  return recorded.value;
}

/** Records a stored step's receipt: `included`, or `reverted` for a receipt with status 0. */
export async function recordReceipt(
  run: ExecutionRun,
  transaction: TransactionRecord,
  receipt: TxReceipt,
): Promise<Watched> {
  const { parts, signal } = run;
  const inclusion = { id: transaction.id, receipt, atMs: parts.clock.now() };
  const recorded = await parts.stores.transactions.recordReceipt(inclusion, { signal });
  if (!recorded.ok) {
    throw new BinferenceError({
      code: "engine.transaction_moved",
      message: `Transaction ${transaction.id} left the states a receipt records.`,
    });
  }
  const outcome = receipt.status === "success" ? "included" : "reverted";
  return { outcome, transaction: recorded.value };
}

// Stuck once the head moved the limit past where the watch began.
function isStuck(head: ChainHead | undefined, firstBlock: bigint | undefined, limit: number) {
  return (
    head !== undefined && firstBlock !== undefined && head.latest - firstBlock >= BigInt(limit)
  );
}

/** Where the watch of one step stands after a number of waits. */
interface WatchState {
  readonly intent: IntentRecord;
  readonly transaction: TransactionRecord;
  readonly sends: number;
  readonly waits: number;
  /** The latest block when the watch first read the head. */
  readonly firstBlock?: bigint;
}

// While no relay has accepted the stored bytes, each wait sends them again, up to the limit.
async function sendIfUnsent(run: ExecutionRun, state: WatchState): Promise<WatchState> {
  if (state.transaction.state !== "signed" || state.sends >= run.parts.limits.sendAttempts) {
    return state;
  }
  const transaction = await sendOnce(run, state.intent, state.transaction);
  return { ...state, transaction, sends: state.sends + 1 };
}

async function watchFrom(run: ExecutionRun, before: WatchState): Promise<Watched> {
  const { parts, plan, signal } = run;
  const { receipts } = plan.sending;
  const { stuckAfterBlocks } = parts.limits;
  if (before.waits >= stuckAfterBlocks * 3) {
    return { outcome: "stuck", transaction: before.transaction };
  }
  const state = await sendIfUnsent(run, before);
  const { transaction } = state;
  const read = async () => receipts.receipt(plan.chain.ref, transaction.hash, { signal });
  const receipt = await readSafely(run, read);
  if (receipt !== undefined) {
    return recordReceipt(run, transaction, receipt);
  }
  const head = await readSafely(run, async () => receipts.head(plan.chain.ref, { signal }));
  const firstBlock = state.firstBlock ?? head?.latest;
  if (isStuck(head, firstBlock, stuckAfterBlocks)) {
    return { outcome: "stuck", transaction };
  }
  await nextBlock(run);
  const waited = { ...state, waits: state.waits + 1 };
  return watchFrom(run, firstBlock === undefined ? waited : { ...waited, firstBlock });
}

/**
 * Sends a stored step and watches each block until a block holds it. While no relay has accepted
 * it, every block sends the same stored bytes again, up to the send limit; nothing is ever signed
 * again. A step with no receipt `stuckAfterBlocks` blocks after the watch began, or after three
 * times as many waits when the head cannot be read, is `stuck` and handed over.
 */
export async function sendAndWatch(
  run: ExecutionRun,
  intent: IntentRecord,
  stored: TransactionRecord,
): Promise<Watched> {
  return watchFrom(run, { intent, transaction: stored, sends: 0, waits: 0 });
}
