import { BinferenceError, type Clock } from "@binference/core";
import type { QuoteView } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { PaperFill } from "../intents/event-cause.schema.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { PriceSource, UsdPrice } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import { type ExecutedTrade, isUsablePrice } from "../positions/value-execution.js";

/**
 * Paper mode's fill step: a confirmed paper intent fills at its confirmed quote, and nothing is
 * signed (ARCHITECTURE.md section 10). The fill is recorded with the move to `paper_filled`, in
 * its event and its ledger entry, and the intent's view shows it as its execution. The fill then
 * moves the wallet's paper positions, which hold its paper portfolio and their own P&L.
 */
export interface PaperFills {
  /**
   * Fills a confirmed paper intent at its confirmed quote: the quote's input for its expected
   * output, at the time of the fill, valued at the sold asset's price then. Any other intent comes
   * back as it was; an intent another write moved first comes back as that write left it. A paper
   * intent whose sold asset has no usable price stays `confirmed`, since a fill is never valued
   * at a guessed price.
   */
  fillAtQuote(
    snapshot: IntentSnapshot,
    options: { readonly signal: AbortSignal },
  ): Promise<IntentSnapshot>;
}

/** What paper fills read the time and prices from, and write through. */
export interface PaperFillsOptions {
  readonly stored: StoredIntents;
  readonly positions: Positions;
  readonly prices: PriceSource;
  readonly clock: Clock;
}

// A paper fill pays no gas, so the native coin's price never counts.
const noGasPrice: UsdPrice = { numerator: 0n, denominator: 1n };
const recordAttempts = 3;

function confirmedQuote(snapshot: IntentSnapshot): QuoteView {
  const { quote } = snapshot.record;
  if (quote === undefined) {
    throw new BinferenceError({
      code: "engine.no_quote",
      message: `Confirmed intent ${snapshot.record.id} has no quote to fill at.`,
      details: { intent: snapshot.record.id },
    });
  }
  return quoteDocument.decode(quote);
}

// The paper execution of a fill: the quote's input for its expected output, with no fee or gas.
function tradeOf(
  snapshot: IntentSnapshot,
  quote: QuoteView,
  priced: { readonly atMs: number; readonly soldPrice: UsdPrice },
): ExecutedTrade {
  const { record } = snapshot;
  return {
    intentId: record.id,
    walletId: record.walletId,
    isPaper: true,
    atMs: priced.atMs,
    sold: quote.amountIn,
    feeBase: 0n,
    bought: quote.expectedOut,
    gas: { asset: quote.gas.asset, base: 0n },
    soldPrice: priced.soldPrice,
    gasPrice: noGasPrice,
  };
}

// A write that loses its race to another fill on the wallet reads the positions again.
async function recordFill(
  positions: Positions,
  trade: ExecutedTrade,
  call: { readonly signal: AbortSignal; readonly attemptsLeft: number },
): Promise<void> {
  const recorded = await positions.record(trade, { signal: call.signal });
  if (recorded.ok) {
    return;
  }
  if (call.attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "engine.positions_stale",
      message: `The paper fill of ${trade.intentId} kept losing its position write.`,
      retryable: true,
      details: { intent: trade.intentId },
    });
  }
  await recordFill(positions, trade, { ...call, attemptsLeft: call.attemptsLeft - 1 });
}

/** Creates the {@link PaperFills} on the state machine, which decides whether an intent fills. */
export function createPaperFills(options: PaperFillsOptions): PaperFills {
  const machine = createIntentStateMachine({ clock: options.clock });
  const { stored } = options;
  return {
    async fillAtQuote(snapshot, { signal }) {
      const step = machine.apply(snapshot.stored.status, { type: "paper_fill_recorded" });
      if (!step.ok) {
        return snapshot;
      }
      const quote = confirmedQuote(snapshot);
      const price = await options.prices.usdPrice(quote.amountIn.asset, { signal });
      if (!price.ok || !isUsablePrice(price.value)) {
        return snapshot;
      }
      const atMs = step.value.event.atMs;
      const fill: PaperFill = { amountIn: quote.amountIn, amountOut: quote.expectedOut, atMs };
      const intent = snapshot.record.id;
      const move = {
        intent,
        version: snapshot.stored.version,
        step: step.value,
        by: "engine",
        fill,
      };
      const moved = await stored.move(move, { signal });
      if (!moved.ok) {
        return (await stored.snapshot(intent, { signal })) ?? snapshot;
      }
      const trade = tradeOf(snapshot, quote, { atMs, soldPrice: price.value });
      await recordFill(options.positions, trade, { signal, attemptsLeft: recordAttempts });
      return moved.value;
    },
  };
}
