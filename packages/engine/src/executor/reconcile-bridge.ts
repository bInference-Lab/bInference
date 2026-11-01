import { bridgeDraftOf, isSettled, tellSettled } from "../bridges/bridge-settlement.js";
import type { BridgeIntentQuote } from "../intents/bridge-quote.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { DepartureDraft } from "../positions/departure-record.js";
import { type ExecutionRun, moveIntent } from "./executor-run.js";
import { type LandedStep, reconcileDepartures } from "./reconcile-departures.js";

/**
 * A bridge's departures: its deposit, the plan's last step, takes the amount sent out of its
 * position with its gas only when it ran as planned; a reverted deposit, and an approval before it,
 * take only their gas, which leaves the coin's position, since neither moved the token.
 */
export function bridgeDeparturesOf(
  snapshot: IntentSnapshot,
  quote: BridgeIntentQuote,
  steps: { readonly landed: readonly LandedStep[]; readonly depositStep: number },
): readonly DepartureDraft[] {
  const { walletId, changedAtMs: atMs } = snapshot.record;
  return steps.landed.map(({ step, gas, txHash, succeeded }) =>
    step === steps.depositStep && succeeded
      ? { walletId, atMs, sent: quote.amount, gas, txHash }
      : { walletId, atMs, sent: gas, gas: { asset: gas.asset, base: 0n }, txHash },
  );
}

// Once the deposit's departures are stored, the bridge opens in transit, once; a bridge a read
// settled before a stop cut its reconciliation short moves to `reconciled` now, its refund already
// recorded by the follower before it settled the row, and the owner is told what the receipt does
// not when this move is the one that landed (decision 0320).
async function openAndFollow(
  run: ExecutionRun,
  finalized: IntentSnapshot,
  call: { readonly quote: BridgeIntentQuote; readonly landed: readonly LandedStep[] },
): Promise<void> {
  const { parts, signal } = run;
  const deposit = call.landed.at(-1);
  if (deposit === undefined) {
    parts.log.warn("executor.settle_waits", { intentId: finalized.record.id });
    return;
  }
  const draft = bridgeDraftOf(finalized.record, call.quote, {
    txHash: deposit.txHash,
    sentAtMs: parts.clock.now(),
  });
  const bridge = await parts.stores.bridges.open(draft, { signal });
  if (!isSettled(bridge)) {
    return;
  }
  const moved = await moveIntent(run, finalized, {
    type: "fills_reconciled",
    isDeliveryRead: true,
  });
  if (moved !== undefined) {
    const told = { install: parts.stores.install, chains: parts.chains, publish: parts.publish };
    await tellSettled(told, { snapshot: finalized, bridge, quote: call.quote }, signal);
  }
}

/**
 * Reconciles a finalized bridge's source leg (decision 0297): its landed deposit takes the amount
 * sent out of its position at average cost, its approval only its gas, stored once, and the bridge
 * opens in transit, once, with the deposit's transaction and the time it became final. It stays
 * `finalized` until a read finds its delivery or refund; a bridge a read settled already moves to
 * `reconciled`.
 */
export async function reconcileBridge(
  run: ExecutionRun,
  finalized: IntentSnapshot,
  quote: BridgeIntentQuote,
): Promise<void> {
  await reconcileDepartures(run, {
    finalized,
    departuresOf: (landed) =>
      bridgeDeparturesOf(finalized, quote, { landed, depositStep: run.plan.steps.length - 1 }),
    departed: async (landed) => openAndFollow(run, finalized, { quote, landed }),
  });
}
