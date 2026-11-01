import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import { bridgeQuoteOf } from "./bridge-queue-check.js";
import type { ExecutionRun } from "./executor-run.js";
import { bridgeDeparturesOf, reconcileBridge } from "./reconcile-bridge.js";
import {
  type LandedStep,
  landedSteps,
  paidSteps,
  reconcileDepartures,
} from "./reconcile-departures.js";
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

// What a dropped step that landed after all took out of its wallet, as its reconciliation would
// store it: a send's, a revoke's or a bridge's source leg; `undefined` for a trade.
async function lateDeparturesOf(
  run: ExecutionRun,
  dropped: IntentSnapshot,
): Promise<readonly DepartureDraft[] | undefined> {
  const bridge = bridgeQuoteOf(dropped.record);
  if (bridge !== undefined) {
    // A dropped deposit that landed reverted takes only its gas (decision 0320).
    const landed = await paidSteps(run, dropped);
    return bridgeDeparturesOf(dropped, bridge, { landed, depositStep: run.plan.steps.length - 1 });
  }
  const transfer = transferQuoteOf(dropped.record);
  return transfer === undefined
    ? undefined
    : departuresOf(dropped, transfer, await landedSteps(run, dropped));
}

/**
 * Takes what a send's, a revoke's or a bridge's dropped step took out of its wallet, once it
 * landed after all (decision 0147), out of the positions as departures once, as its
 * reconciliation would: `trade` for any other intent, which books as a trade instead. A bridge's
 * delivery is not followed: its intent stays `failed_onchain`. A store that refuses the departures
 * is logged.
 */
export async function departLateLanding(
  run: ExecutionRun,
  dropped: IntentSnapshot,
): Promise<"trade" | "departed" | "waits"> {
  const departures = await lateDeparturesOf(run, dropped);
  if (departures === undefined) {
    return "trade";
  }
  const intentId = dropped.record.id;
  const departed =
    departures.length === 0 ||
    (await run.parts.valuedPositions.depart({ intentId, departures }, { signal: run.signal })).ok;
  if (!departed) {
    run.parts.log.warn("executor.settle_waits", { intentId });
  }
  return departed ? "departed" : "waits";
}

/**
 * Reconciles a finalized live intent (ARCHITECTURE.md section 7, step 9): a send or an approval
 * revoke as departures (decision 0127), what its landed step took out of its wallet, a bridge as
 * its source leg's departures and the delivery it follows (decision 0297), and any other intent as
 * the trade it settled.
 */
export async function reconcileFinalized(
  run: ExecutionRun,
  finalized: IntentSnapshot,
): Promise<void> {
  const bridge = bridgeQuoteOf(finalized.record);
  if (bridge !== undefined) {
    await reconcileBridge(run, finalized, bridge);
    return;
  }
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
