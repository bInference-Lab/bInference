import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import type { ExecutionRun } from "./executor-run.js";
import { type LandedStep, landedSteps, reconcileDepartures } from "./reconcile-departures.js";
import { reconcileTrade } from "./reconcile-trade.js";
import { type TransferQuote, transferQuoteOf } from "./transfer-queue-check.js";

// A send that landed takes its amount and its gas out of the positions; a revoke only its gas,
// which leaves the coin's position as what it sent (decision 0309).
function departuresOf(
  snapshot: IntentSnapshot,
  transfer: TransferQuote,
  landed: readonly LandedStep[],
): readonly DepartureDraft[] {
  const { walletId, changedAtMs: atMs } = snapshot.record;
  return landed.map(({ gas, txHash }) =>
    transfer.kind === "send"
      ? { walletId, atMs, sent: transfer.quote.amount, gas, txHash }
      : { walletId, atMs, sent: gas, gas: { asset: gas.asset, base: 0n }, txHash },
  );
}

/**
 * Takes a send's or a revoke's landed step out of the positions as a departure once, as its
 * reconciliation would, for a dropped step that landed after all (decision 0147); true when that
 * is stored, or when the intent is no send or revoke. A store that refuses it is logged.
 */
export async function departLateTransfer(
  run: ExecutionRun,
  dropped: IntentSnapshot,
): Promise<boolean> {
  const transfer = transferQuoteOf(dropped.record);
  if (transfer === undefined) {
    return true;
  }
  const intentId = dropped.record.id;
  const departures = departuresOf(dropped, transfer, await landedSteps(run, dropped));
  const departed =
    departures.length === 0 ||
    (await run.parts.valuedPositions.depart({ intentId, departures }, { signal: run.signal })).ok;
  if (!departed) {
    run.parts.log.warn("executor.settle_waits", { intentId });
  }
  return departed;
}

/**
 * Reconciles a finalized live intent (ARCHITECTURE.md section 7, step 9): a send or an approval
 * revoke as departures (decision 0127), what its landed step took out of its wallet, and any other
 * intent as the trade it settled.
 */
export async function reconcileFinalized(
  run: ExecutionRun,
  finalized: IntentSnapshot,
): Promise<void> {
  const transfer = transferQuoteOf(finalized.record);
  if (transfer === undefined) {
    await reconcileTrade(run, finalized);
    return;
  }
  const settling = {
    finalized,
    departuresOf: (landed: readonly LandedStep[]) => departuresOf(finalized, transfer, landed),
  };
  await reconcileDepartures(run, settling);
}
