import type { TxReceipt } from "@binference/chain";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import type { ExecutionRun } from "./executor-run.js";
import { isTurnedAway } from "./run-step.js";
import { type NonceTransactions, readFate } from "./step-fate.js";

/**
 * What the drop rule found (decision 0115): a block holds one of the step's transactions after
 * all, another transaction used its nonce, the step was recorded `dropped`, or no node answered.
 */
export type DropOutcome =
  | {
      readonly kind: "landed";
      readonly transaction: TransactionRecord;
      readonly receipt: TxReceipt;
    }
  | { readonly kind: "taken" | "unread" | "held" }
  | { readonly kind: "dropped"; readonly transaction: TransactionRecord };

// A transaction the step replaced is gone once no relay ever took it, or every relay turned
// away its last send: a relay that took it and was never asked again may hold it still.
async function isGone(run: ExecutionRun, rival: TransactionRecord): Promise<boolean> {
  if (rival.sentAtMs === undefined) {
    return true;
  }
  const answers = await run.parts.stores.transactions.sends(rival.id, { signal: run.signal });
  return isTurnedAway(answers.slice(-run.plan.sending.sender.relays.length));
}

/**
 * Drops a stuck step every relay refused (decision 0115) once the chain shows its nonce still
 * free and no relay may hold a transaction the step replaced: the step's transaction is recorded
 * `dropped`, which frees its nonce for the next step. It signs and sends nothing.
 */
export async function dropStep(run: ExecutionRun, at: NonceTransactions): Promise<DropOutcome> {
  const { parts, signal } = run;
  const gone = await Promise.all(at.rivals.map(async (rival) => isGone(run, rival)));
  if (!gone.every(Boolean)) {
    return { kind: "held" };
  }
  const fate = await readFate(run, at);
  if (fate === undefined || fate.kind === "taken") {
    return { kind: fate === undefined ? "unread" : "taken" };
  }
  if (fate.kind === "found") {
    return { kind: "landed", transaction: fate.transaction, receipt: fate.receipt };
  }
  const mark = { id: at.transaction.id, atMs: parts.clock.now() };
  const dropped = await parts.stores.transactions.recordDropped(mark, { signal });
  return dropped.ok ? { kind: "dropped", transaction: dropped.value } : { kind: "unread" };
}
