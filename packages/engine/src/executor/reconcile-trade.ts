import { type TxHash, withQuotePrice } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { QuoteView } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import { quoteDocument, simulationDocument } from "../intents/intent-documents.schema.js";
import { type ExecutedTrade, isUsablePrice } from "../positions/value-execution.js";
import { noticePush } from "../pushes/notice-push.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { type ExecutionRun, moveIntent, nextBlock, readSafely } from "./executor-run.js";
import { differsFromSimulation, type SettledStep, settledTradeOf } from "./settled-trade-of.js";

// The owner's alarm when a trade settles more than 1% away from its simulation.
const fillDiffersNoticeKey = "notice.fillDiffers";

function confirmedQuote(snapshot: IntentSnapshot): QuoteView {
  const { quote, id } = snapshot.record;
  if (quote === undefined) {
    throw new BinferenceError({
      code: "engine.no_quote",
      message: `Finalized intent ${id} has no quote to reconcile against.`,
      details: { intent: id },
    });
  }
  return quoteDocument.decode(quote);
}

// What each final step moved, or `undefined` while a read fails or a node no longer holds one.
async function settledSteps(
  run: ExecutionRun,
  steps: readonly TransactionRecord[],
): Promise<readonly SettledStep[] | undefined> {
  const { plan, signal } = run;
  const read = await Promise.all(
    steps.map(async (transaction) =>
      readSafely(run, async () =>
        plan.sending.receipts.transfers(plan.chain.ref, transaction.hash, { signal }),
      ),
    ),
  );
  const settled = steps.flatMap((transaction, index) => {
    const transfers = read[index];
    return transfers === undefined ? [] : [{ transaction, transfers }];
  });
  return settled.length === steps.length ? settled : undefined;
}

// The trade valued at the sold asset's and the native coin's prices now; a sold token with no
// feed takes its price from the confirmed quote, as the policy step priced it.
async function pricedTrade(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  settled: { readonly trade: SettledTrade; readonly quote: QuoteView; readonly txHash: TxHash },
): Promise<ExecutedTrade | undefined> {
  const { trade, quote, txHash } = settled;
  const { signal } = run;
  const prices = withQuotePrice(run.parts.prices, quote);
  const [soldPrice, gasPrice] = await Promise.all([
    prices.usdPrice(trade.amountIn.asset, { signal }),
    prices.usdPrice(trade.gas.asset, { signal }),
  ]);
  if (!soldPrice.ok || !gasPrice.ok) {
    return undefined;
  }
  if (!isUsablePrice(soldPrice.value) || !isUsablePrice(gasPrice.value)) {
    return undefined;
  }
  const { record } = snapshot;
  return {
    intentId: record.id,
    walletId: record.walletId,
    isPaper: false,
    atMs: trade.atMs,
    sold: trade.amountIn,
    feeBase: 0n,
    bought: trade.amountOut,
    gas: trade.gas,
    txHash,
    soldPrice: soldPrice.value,
    gasPrice: gasPrice.value,
  };
}

// The execution goes in once: a restart that reconciles the intent again finds it stored.
async function recordOnce(run: ExecutionRun, trade: ExecutedTrade): Promise<boolean> {
  const { parts, signal } = run;
  const query = {
    isPaper: false,
    walletId: trade.walletId,
    fromMs: trade.atMs,
    toMs: trade.atMs,
    after: 0,
    limit: 1_000,
  };
  const stored = await parts.positions.executions(query, { signal });
  if (stored.some(({ intentId }) => intentId === trade.intentId)) {
    return true;
  }
  const recorded = await parts.valuedPositions.record(trade, { signal });
  return recorded.ok;
}

function warnDifference(run: ExecutionRun, snapshot: IntentSnapshot, trade: SettledTrade): void {
  const { simulation, id, agentId } = snapshot.record;
  if (
    simulation === undefined ||
    !differsFromSimulation(trade, simulationDocument.decode(simulation))
  ) {
    return;
  }
  run.parts.log.warn("executor.fill_differs", { intentId: id });
  run.parts.publish(
    noticePush({ key: fillDiffersNoticeKey, agent: agentId, intent: id, values: {} }),
  );
}

// One try: what the steps moved, priced, recorded in the positions, then the move. `false` when
// a read, a price or the position write must wait for the next block.
async function settleOnce(run: ExecutionRun, snapshot: IntentSnapshot): Promise<boolean> {
  const { parts, signal } = run;
  const quote = confirmedQuote(snapshot);
  const stored = await parts.stores.transactions.ofIntent(snapshot.record.id, { signal });
  const steps = await settledSteps(
    run,
    stored.filter(({ state }) => state === "final"),
  );
  if (steps === undefined) {
    return false;
  }
  const last = steps.at(-1);
  if (last === undefined) {
    throw new BinferenceError({
      code: "engine.no_final_step",
      message: `Finalized intent ${snapshot.record.id} has no final transaction.`,
      details: { intent: snapshot.record.id },
    });
  }
  const holder = { wallet: run.plan.steps[0].from, family: run.plan.chain.family };
  const trade = settledTradeOf(steps, { quote, holder, atMs: snapshot.record.changedAtMs });
  const txHash = last.transaction.hash;
  const priced = await pricedTrade(run, snapshot, { trade, quote, txHash });
  if (priced === undefined || !(await recordOnce(run, priced))) {
    parts.log.warn("executor.settle_waits", { intentId: snapshot.record.id });
    return false;
  }
  const settling = { trigger: { type: "fills_reconciled" }, settled: trade } as const;
  const reconciled = await moveIntent(run, snapshot, settling);
  if (reconciled !== undefined) {
    parts.log.info("executor.reconciled", { intentId: snapshot.record.id });
    warnDifference(run, snapshot, trade);
  }
  return true;
}

/**
 * Reconciles a finalized live intent (ARCHITECTURE.md section 7, step 9): reads what each final
 * step moved, turns it into the trade, values it and records it in the positions once, then
 * moves the intent to `reconciled` with the trade, whose ledger entry and pushes every surface
 * hears. A trade more than 1% away from its simulation still reconciles, with an alarm notice.
 * While a read or a price fails it tries again each block, up to `settleAfterBlocks`; then it
 * leaves the intent `finalized`.
 */
export async function reconcileTrade(
  run: ExecutionRun,
  finalized: IntentSnapshot,
  attempt = 0,
): Promise<void> {
  if (attempt >= run.parts.limits.settleAfterBlocks) {
    run.parts.log.warn("executor.settle_late", { intentId: finalized.record.id });
    return;
  }
  if (await settleOnce(run, finalized)) {
    return;
  }
  await nextBlock(run);
  await reconcileTrade(run, finalized, attempt + 1);
}
