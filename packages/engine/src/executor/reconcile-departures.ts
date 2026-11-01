import type { Amount, TxHash } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, moveIntent, nextBlock } from "./executor-run.js";
import { currentSteps } from "./recover-steps.js";

/**
 * One step of an intent that landed: its place in the plan, the gas it paid, its transaction, and
 * whether it ran as planned or reverted, which moved nothing but its gas.
 */
export interface LandedStep {
  readonly step: number;
  readonly gas: Amount;
  readonly txHash: TxHash;
  readonly succeeded: boolean;
}

// A step a block ran, final or reverted, that is not a cancel that took its nonce.
function isOwnRun(transaction: TransactionRecord): boolean {
  return (
    (transaction.state === "final" || transaction.state === "reverted") &&
    transaction.replaces?.kind !== "cancel"
  );
}

/**
 * Every step of the intent a block ran, final or reverted, with the native coin its receipt paid.
 * A caller reads it once those blocks are final.
 */
export async function paidSteps(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
): Promise<readonly LandedStep[]> {
  const native = nativeAssetOf(run.plan.chain);
  const stored = await run.parts.stores.transactions.ofIntent(snapshot.record.id, {
    signal: run.signal,
  });
  return [...currentSteps(stored).values()].filter(isOwnRun).flatMap(({ step, receipt, hash }) =>
    receipt === undefined
      ? []
      : [
          {
            step,
            gas: { asset: native, base: receipt.gasUsed * receipt.feePerGasBase },
            txHash: hash,
            succeeded: receipt.status === "success",
          },
        ],
  );
}

/** Every step of the intent that landed as planned, with the native coin its receipt paid. */
export async function landedSteps(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
): Promise<readonly LandedStep[]> {
  return (await paidSteps(run, snapshot)).filter((step) => step.succeeded);
}

/**
 * Reconciles a finalized intent that sends without a trade (decision 0127): what its landed steps
 * took out of its wallets, as `departuresOf` reads them, leaves the positions at average cost with
 * no gain or loss, recorded once, and the intent moves to `reconciled`, or on as `departed` says.
 * While the positions cannot
 * store it, it tries again each block, up to `settleAfterBlocks`; then it leaves the intent
 * `finalized`, and recovery reconciles it after a restart.
 */
export async function reconcileDepartures(
  run: ExecutionRun,
  settling: {
    readonly finalized: IntentSnapshot;
    readonly departuresOf: (landed: readonly LandedStep[]) => readonly DepartureDraft[];
    /**
     * What follows once the departures are stored, such as a bridge's delivery to follow; the move
     * to `reconciled` when absent.
     */
    readonly departed?: (landed: readonly LandedStep[]) => Promise<void>;
  },
  attempt = 0,
): Promise<void> {
  const { parts, signal } = run;
  const { finalized, departuresOf } = settling;
  const intentId = finalized.record.id;
  if (attempt >= parts.limits.settleAfterBlocks) {
    parts.log.warn("executor.settle_late", { intentId });
    return;
  }
  const landed = await landedSteps(run, finalized);
  const departures = departuresOf(landed);
  const stored =
    departures.length === 0 ||
    (await parts.valuedPositions.depart({ intentId, departures }, { signal })).ok;
  if (stored && settling.departed !== undefined) {
    await settling.departed(landed);
    return;
  }
  if (stored) {
    await moveIntent(run, finalized, { type: "fills_reconciled" });
    return;
  }
  parts.log.warn("executor.settle_waits", { intentId });
  await nextBlock(run);
  await reconcileDepartures(run, settling, attempt + 1);
}
