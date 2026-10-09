import { BinferenceError } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { type RescueQuote, rescueQuoteDocument } from "../intents/rescue-quote.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, moveIntent, nextBlock } from "./executor-run.js";
import { currentSteps } from "./recover-steps.js";

function rescueQuoteOf(snapshot: IntentSnapshot): RescueQuote {
  const { quote, id } = snapshot.record;
  if (quote === undefined) {
    throw new BinferenceError({
      code: "engine.no_quote",
      message: `Finalized rescue ${id} has no quote to reconcile against.`,
      details: { intent: id },
    });
  }
  return rescueQuoteDocument.decode(quote);
}

// A step that sent its move: final, successful, and not a cancel that took its nonce instead.
function hasSent(transaction: TransactionRecord): boolean {
  return (
    transaction.state === "final" &&
    transaction.receipt?.status === "success" &&
    transaction.replaces?.kind !== "cancel"
  );
}

// What each landed send took out of its wallet: its move's amount, and the gas its receipt paid.
async function departuresOf(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
): Promise<readonly DepartureDraft[]> {
  const { record } = snapshot;
  const { moves } = rescueQuoteOf(snapshot);
  const native = nativeAssetOf(run.plan.chain);
  const stored = await run.parts.stores.transactions.ofIntent(record.id, { signal: run.signal });
  return [...currentSteps(stored).values()].filter(hasSent).flatMap(({ step, receipt, hash }) => {
    const move = moves[step];
    return move === undefined || receipt === undefined
      ? []
      : [
          {
            walletId: move.wallet,
            atMs: record.changedAtMs,
            sent: move.amount,
            gas: { asset: native, base: receipt.gasUsed * receipt.feePerGasBase },
            txHash: hash,
          },
        ];
  });
}

/**
 * Reconciles a finalized rescue (decision 0127): what each of its landed sends took out of its
 * wallet, the units sent and the gas paid, leaves the positions at average cost with no gain or
 * loss, recorded once, and the rescue moves to `reconciled`. While the positions cannot store it,
 * it tries again each block, up to `settleAfterBlocks`; then it leaves the rescue `finalized`, and
 * recovery reconciles it after a restart.
 */
export async function reconcileRescue(
  run: ExecutionRun,
  finalized: IntentSnapshot,
  attempt = 0,
): Promise<void> {
  const { parts, signal } = run;
  const intentId = finalized.record.id;
  if (attempt >= parts.limits.settleAfterBlocks) {
    parts.log.warn("executor.settle_late", { intentId });
    return;
  }
  const departures = await departuresOf(run, finalized);
  const stored =
    departures.length === 0 ||
    (await parts.valuedPositions.depart({ intentId, departures }, { signal })).ok;
  if (stored) {
    await moveIntent(run, finalized, { type: "fills_reconciled" });
    return;
  }
  parts.log.warn("executor.settle_waits", { intentId });
  await nextBlock(run);
  await reconcileRescue(run, finalized, attempt + 1);
}
