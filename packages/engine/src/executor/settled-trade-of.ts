import type { Amount, AssetTransfer } from "@binference/chain";
import type { QuoteView, SimulationView } from "@binference/protocol";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import { type WalletHolder, walletChanges } from "../simulation/wallet-changes.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";

/** One step of a live intent once a final block holds it: its transaction and what it moved. */
export interface SettledStep {
  readonly transaction: TransactionRecord;
  readonly transfers: readonly AssetTransfer[];
}

/** What a settled trade is read against: the confirmed quote and the wallet that traded. */
export interface SettlementTerms {
  readonly quote: QuoteView;
  readonly holder: WalletHolder;
  /** When the trade reconciles. */
  readonly atMs: number;
}

// How far a settled trade may land from its simulation before the owner hears: 1% (spec 6).
const fillToleranceBps = 100n;

function atLeastZero(base: bigint): bigint {
  return base > 0n ? base : 0n;
}

// Every step pays its fee in the chain's native coin, the asset the quote prices gas in.
function gasOf(steps: readonly SettledStep[], quote: QuoteView): Amount {
  const base = steps.reduce((sum, { transaction }) => {
    const receipt = transaction.receipt;
    return receipt === undefined ? sum : sum + receipt.gasUsed * receipt.feePerGasBase;
  }, 0n);
  return { asset: quote.gas.asset, base };
}

/**
 * The trade a live intent's final steps made (ARCHITECTURE.md section 7, step 9): the quote's
 * input asset the wallet spent net, the output asset it received net, both read from what the
 * steps moved, the fee every step paid, and each step's hash in step order. A net change the
 * other way, such as an input that came back, counts as 0.
 */
export function settledTradeOf(
  steps: readonly SettledStep[],
  terms: SettlementTerms,
): SettledTrade {
  const { quote, holder, atMs } = terms;
  const changes = walletChanges(
    steps.flatMap(({ transfers }) => transfers),
    holder,
  );
  const inAsset = quote.amountIn.asset;
  const outAsset = quote.expectedOut.asset;
  return {
    amountIn: { asset: inAsset, base: atLeastZero(-(changes.get(inAsset) ?? 0n)) },
    amountOut: { asset: outAsset, base: atLeastZero(changes.get(outAsset) ?? 0n) },
    gas: gasOf(steps, quote),
    txHashes: steps.map(({ transaction }) => transaction.hash),
    atMs,
  };
}

// An amount differs once it lands more than the tolerance away from the simulation's amount of
// its asset; an asset the simulation never named differs.
function differs(actual: Amount, simulated: readonly Amount[]): boolean {
  const expected = simulated.find(({ asset }) => asset === actual.asset);
  if (expected === undefined) {
    return true;
  }
  const gap =
    actual.base > expected.base ? actual.base - expected.base : expected.base - actual.base;
  return gap * 10_000n > expected.base * fillToleranceBps;
}

/**
 * Whether a settled trade spent or received more than 1% away from what its simulation showed
 * (spec 6, section 3): the intent still reconciles, and the owner gets an alarm notice.
 */
export function differsFromSimulation(trade: SettledTrade, simulation: SimulationView): boolean {
  return differs(trade.amountIn, simulation.spent) || differs(trade.amountOut, simulation.received);
}
