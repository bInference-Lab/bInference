import type { TxReceipt } from "@binference/chain";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, readSafely } from "./executor-run.js";
import { isTurnedAway } from "./run-step.js";
import { finalFate, type NonceTransactions, readFate } from "./step-fate.js";

/**
 * What the drop rule found (decision 0115): a block holds one of the step's transactions after
 * all, another transaction used its nonce, a relay or a node may still hold the step (`held`), the
 * step was recorded `dropped`, or no node answered.
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

// A node that counts a transaction of the wallet at the step's nonce in its pool, or knows any of
// the step's transactions, may yet see one land: the step is held while it does.
async function isHeldByNode(
  run: ExecutionRun,
  at: NonceTransactions,
): Promise<boolean | undefined> {
  const { plan, signal } = run;
  const { receipts } = plan.sending;
  const { account, nonce } = at.transaction;
  return readSafely(run, async () => {
    if ((await receipts.nonceAt(account, "pending", { signal })) > nonce) {
      return true;
    }
    const known = await Promise.all(
      [at.transaction, ...at.rivals].map(async ({ hash }) =>
        receipts.isKnown(plan.chain.ref, hash, { signal }),
      ),
    );
    return known.includes(true);
  });
}

// What the chain shows that keeps the step: `undefined` once its nonce is free and no node holds
// any of its transactions.
async function chainHold(
  run: ExecutionRun,
  at: NonceTransactions,
): Promise<DropOutcome | undefined> {
  const read = await readFate(run, at);
  const fate = read?.kind === "taken" ? await finalFate(run, at) : read;
  if (fate === undefined || fate.kind === "taken") {
    return { kind: fate === undefined ? "unread" : "taken" };
  }
  if (fate.kind === "found") {
    return { kind: "landed", transaction: fate.transaction, receipt: fate.receipt };
  }
  const isHeld = await isHeldByNode(run, at);
  return isHeld === false ? undefined : { kind: isHeld === undefined ? "unread" : "held" };
}

/**
 * Drops a stuck step every relay refused (decision 0115) once the chain shows its nonce still
 * free, even counting what a node holds in its pool, no node knows any of the step's transactions,
 * and no relay may hold a transaction the step replaced: the step's transaction is recorded
 * `dropped`, which frees its nonce for the next step. It signs and sends nothing.
 */
export async function dropStep(run: ExecutionRun, at: NonceTransactions): Promise<DropOutcome> {
  const { parts, signal } = run;
  const gone = await Promise.all(at.rivals.map(async (rival) => isGone(run, rival)));
  if (!gone.every(Boolean)) {
    return { kind: "held" };
  }
  const onChain = await chainHold(run, at);
  if (onChain !== undefined) {
    return onChain;
  }
  const mark = { id: at.transaction.id, atMs: parts.clock.now() };
  const dropped = await parts.stores.transactions.recordDropped(mark, { signal });
  return dropped.ok ? { kind: "dropped", transaction: dropped.value } : { kind: "unread" };
}
