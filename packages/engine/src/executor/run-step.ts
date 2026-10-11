import type {
  PreparedTx,
  RelayAnswer,
  RelayRefusal,
  SignedTx,
  SignRequest,
  StepReplacement,
  TxDraft,
  TxReceipt,
} from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { IntentRecord } from "../intents/intent-record.js";
import type { SignedTransaction, TransactionRecord } from "../wallet-queue/transaction-record.js";
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

/**
 * Why a step was not signed, or not stored once signed: nothing was sent for it. `wrong_state`:
 * the transaction a replacement was for is no longer signed or sent. `sign_fault`: custody or the
 * signer failed, and `eth_signTransaction` broadcasts nothing, so nothing left this machine.
 */
export type SignStop =
  | "would_fail"
  | "refused"
  | "unknown_wallet"
  | "bad_signature"
  | "nonce_taken"
  | "wrong_state"
  | "sign_fault";

// A fault of a call the run did not stop is logged with its code; the run's own stop is thrown on.
function logFault(run: ExecutionRun, event: string, errorCode: string): void {
  run.signal.throwIfAborted();
  run.parts.log.warn(event, { chain: run.plan.chain.ref, errorCode });
}

/** What a stuck step's replacement takes the nonce of, and what the signer checks it against. */
export interface StepReplacing {
  readonly transaction: TransactionRecord;
  readonly replaces: StepReplacement;
}

/**
 * Takes the next nonce from the slot and prepares the step's draft at it, read from the chain.
 * `unprepared` when no node gave the nonce or the fees, logged as `executor.prepare_failed`.
 */
export async function prepareStep(
  run: ExecutionRun,
  slot: WalletSlot,
  step: { readonly index: number; readonly draft: TxDraft },
): Promise<Result<PreparedStep, "would_fail" | "unprepared">> {
  const { signal, plan } = run;
  const { index, draft } = step;
  try {
    const { nonce } = await slot.nextNonce({ signal });
    const prepared = await plan.sending.preparer.prepare({ draft, nonce }, { signal });
    return prepared.ok ? ok({ index, draft, nonce, prepared: prepared.value }) : prepared;
  } catch (error) {
    logFault(
      run,
      "executor.prepare_failed",
      error instanceof BinferenceError ? error.code : "unexpected",
    );
    return err("unprepared");
  }
}

// Custody signs; a fault there signed nothing that left this machine.
async function signed(
  run: ExecutionRun,
  request: SignRequest,
): Promise<Result<SignedTx, "unknown_wallet" | "refused" | "sign_fault">> {
  try {
    return await run.parts.custody.signTransaction(request, { signal: run.signal });
  } catch (error) {
    logFault(
      run,
      "executor.sign_failed",
      error instanceof BinferenceError ? error.code : "unexpected",
    );
    return err("sign_fault");
  }
}

// Stores the signed bytes in the slot: a replacement at the nonce it takes, any other at the
// nonce the slot gave.
async function storeSigned(
  slot: WalletSlot,
  transaction: SignedTransaction,
  call: { readonly replacing?: StepReplacing; readonly signal: AbortSignal },
): Promise<Result<TransactionRecord, SignStop>> {
  const { replacing, signal } = call;
  if (replacing === undefined) {
    const saved = await slot.saveSigned(transaction, { signal });
    return saved.ok ? saved : err("nonce_taken");
  }
  const replaces = { id: replacing.transaction.id, kind: replacing.replaces.kind };
  return slot.saveReplacement({ ...transaction, replaces }, { signal });
}

/**
 * Signs a prepared step through custody with what authorized the intent, checks that the signed
 * bytes are the step's own through the chain's signing scheme, and stores them in the slot before
 * anything is sent (ARCHITECTURE.md rule 6). A stuck step's replacement carries what it replaces
 * to the signer, and takes the nonce of the transaction it replaces (spec 6, section 6).
 */
export async function signAndStore(
  run: ExecutionRun,
  slot: WalletSlot,
  step: {
    readonly record: IntentRecord;
    readonly terms: SigningTerms;
    readonly ready: PreparedStep;
    readonly replacing?: StepReplacing;
  },
): Promise<Result<TransactionRecord, SignStop>> {
  const { parts, plan, signal } = run;
  const { record, terms, ready, replacing } = step;
  const { index, draft, nonce, prepared } = ready;
  const { unsigned } = prepared;
  const request = signRequestOf({
    record,
    chain: plan.chain,
    terms,
    index,
    draft,
    unsigned,
    ...(replacing === undefined ? {} : { replaces: replacing.replaces }),
  });
  const signature = await signed(run, request);
  if (!signature.ok) {
    return signature;
  }
  const hash = plan.chain.signingScheme.verify(unsigned, signature.value);
  if (!hash.ok) {
    return err("bad_signature");
  }
  const transaction = {
    id: parts.ids.next("tx"),
    intentId: record.id,
    step: index,
    account: slot.account,
    nonce,
    raw: signature.value.raw,
    hash: hash.value,
    signedAtMs: parts.clock.now(),
  };
  return storeSigned(slot, transaction, {
    ...(replacing === undefined ? {} : { replacing }),
    signal,
  });
}

/** One send's outcome: the transaction as stored after it, and whether every relay refused it. */
export interface SendOutcome {
  readonly transaction: TransactionRecord;
  /**
   * Every relay refused the bytes with an answer that says it does not hold them (decision
   * 0115): not a nonce a block used, a rival it holds at the nonce, its rate limit, or an answer
   * outside its protocol.
   */
  readonly isRefused: boolean;
}

/**
 * Whether one send's answers turned the bytes away (decision 0115): every relay refused them with
 * an answer that says it holds none of them.
 */
export function isTurnedAway(answers: readonly RelayAnswer[]): boolean {
  return (
    answers.length > 0 &&
    answers.every((answer) => answer.outcome === "refused" && goneReasons.has(answer.reason))
  );
}

// The refusals that say a relay holds no transaction at the nonce: it checked these bytes and
// turned them away.
const goneReasons: ReadonlySet<RelayRefusal> = new Set<RelayRefusal>([
  "underpriced",
  "insufficient_funds",
  "gas_quota",
  "malformed_transaction",
  "rejected",
]);

/**
 * One send of a stored transaction's bytes to every relay, each answer recorded. The first
 * acceptance moves a `signed` step to `sent` and records the send in the ledger. Nothing is
 * signed.
 */
export async function sendOnce(
  run: ExecutionRun,
  intent: IntentRecord,
  transaction: TransactionRecord,
): Promise<SendOutcome> {
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
  return { transaction: recorded.value, isRefused: isTurnedAway(answers) };
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
