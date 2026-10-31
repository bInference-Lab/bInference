import { BinferenceError } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { type RescueQuote, rescueQuoteDocument } from "../intents/rescue-quote.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import type { ExecutionRun } from "./executor-run.js";
import { type LandedStep, reconcileDepartures } from "./reconcile-departures.js";

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

// What each landed send took out of its wallet: its move's amount, and the gas its receipt paid.
function departuresOf(
  snapshot: IntentSnapshot,
  landed: readonly LandedStep[],
): readonly DepartureDraft[] {
  const { moves } = rescueQuoteOf(snapshot);
  const atMs = snapshot.record.changedAtMs;
  return landed.flatMap(({ step, gas, txHash }) => {
    const move = moves[step];
    return move === undefined
      ? []
      : [{ walletId: move.wallet, atMs, sent: move.amount, gas, txHash }];
  });
}

/**
 * Reconciles a finalized rescue (decision 0127): what each of its landed sends took out of its
 * wallet, the units sent and the gas paid, leaves the positions at average cost with no gain or
 * loss, recorded once, and the rescue moves to `reconciled`. While the positions cannot store it,
 * it tries again each block, up to `settleAfterBlocks`; then it leaves the rescue `finalized`, and
 * recovery reconciles it after a restart.
 */
export async function reconcileRescue(run: ExecutionRun, finalized: IntentSnapshot): Promise<void> {
  const settling = {
    finalized,
    departuresOf: (landed: readonly LandedStep[]) => departuresOf(finalized, landed),
  };
  await reconcileDepartures(run, settling);
}
