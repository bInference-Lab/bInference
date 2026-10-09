import type { PreparedTx, TxDraft, TxReceipt } from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { WalletSlot } from "../wallet-queue/wallet-slot.js";
import type { ExecutionRun } from "./executor-run.js";
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
 * One send of a stored transaction's bytes to every relay, each answer recorded. The first
 * acceptance moves a `signed` step to `sent` and records the send in the ledger. Nothing is
 * signed.
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
  }
  // The ledger hears of a transaction once, when a relay first takes it; a send of the same bytes
  // again after that is no new event.
  if (accepted.length > 0 && transaction.state === "signed") {
    const relays = accepted.map(({ relay }) => relay);
    await recordStepSent(run, intent, { transaction: recorded.value, relays });
  }
  if (accepted.length === 0) {
    parts.log.warn("executor.send_failed", { intentId, chain: plan.chain.ref });
  }
  return recorded.value;
}

/**
 * Records a stored step's receipt: `included`, or `reverted` for a receipt with status 0. The
 * store supersedes the step's other transactions at its nonce in the same write.
 */
export async function recordReceipt(
  run: ExecutionRun,
  transaction: TransactionRecord,
  receipt: TxReceipt,
): Promise<TransactionRecord> {
  const { parts, signal } = run;
  const inclusion = { id: transaction.id, receipt, atMs: parts.clock.now() };
  const recorded = await parts.stores.transactions.recordReceipt(inclusion, { signal });
  if (!recorded.ok) {
    throw new BinferenceError({
      code: "engine.transaction_moved",
      message: `Transaction ${transaction.id} left the states a receipt records.`,
    });
  }
  return recorded.value;
}
