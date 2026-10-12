import { type AssetRef, type PriceSource, type UsdPrice, withQuotePrice } from "@binference/chain";
import { BinferenceError, type Clock } from "@binference/core";
import type { QuoteView } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { PaperFill } from "../intents/event-cause.schema.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { OrderFillWrite } from "../orders/order-fill.js";
import type { Positions } from "../positions/create-positions.js";
import { type ExecutedTrade, isUsablePrice } from "../positions/value-execution.js";
import type { PaperPortfolio } from "./paper-portfolio.js";

/**
 * Paper mode's fill step: a confirmed paper intent fills at its confirmed quote, and nothing is
 * signed (ARCHITECTURE.md section 10). The fill is recorded with the move to `paper_filled`, in
 * its event and its ledger entry, with the price it is valued at, and the intent's view shows it
 * as its execution. The fill then moves the wallet's paper positions, which hold its paper
 * portfolio and their own P&L.
 */
export interface PaperFills {
  /**
   * Fills a confirmed paper intent at its confirmed quote: the quote's input for its expected
   * output, at the time of the fill, valued at the sold asset's price then. A sold token the
   * price source cannot price takes its price from that quote, as the policy step priced it. Any
   * other intent comes back as it was; an intent another write moved first comes back as that
   * write left it. A paper intent whose sold asset has no usable price stays `confirmed`, since a
   * fill is never valued at a guessed price. A sale or a swap whose paper portfolio now holds less
   * of its input than the confirmed quote spends, as when another fill sold it first, ends
   * `failed_check` with `nothing_to_sell`, and moves nothing. An auto order's fill passes `order`,
   * which answers the fill's write on its order; it lands with the move, or neither does, and an
   * answer of none leaves the intent `confirmed`.
   */
  fillAtQuote(
    snapshot: IntentSnapshot,
    options: {
      readonly signal: AbortSignal;
      readonly order?: (fill: PaperFill) => Promise<OrderFillWrite | undefined>;
    },
  ): Promise<IntentSnapshot>;
}

/** What paper fills read the time and prices from, and write through. */
export interface PaperFillsOptions {
  readonly stored: StoredIntents;
  readonly positions: Positions;
  /** What each wallet holds on paper now, which a sale or a swap must still cover. */
  readonly portfolio: Pick<PaperPortfolio, "balance">;
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

/**
 * The paper execution of a fill: its input for its output at the price it was valued at, with no
 * fee or gas, in the gas asset given.
 */
export function paperTrade(
  record: Pick<IntentRecord, "id" | "walletId">,
  fill: PaperFill & { readonly soldPrice: UsdPrice },
  gasAsset: AssetRef,
): ExecutedTrade {
  return {
    intentId: record.id,
    walletId: record.walletId,
    isPaper: true,
    atMs: fill.atMs,
    sold: fill.amountIn,
    feeBase: 0n,
    bought: fill.amountOut,
    gas: { asset: gasAsset, base: 0n },
    soldPrice: fill.soldPrice,
    gasPrice: noGasPrice,
  };
}

/**
 * Records a paper execution in the positions; a write that loses its race to another fill on the
 * wallet reads the positions again, up to three times in all, then throws
 * `engine.positions_stale`.
 */
export async function recordFill(
  positions: Positions,
  trade: ExecutedTrade,
  call: { readonly signal: AbortSignal; readonly attemptsLeft?: number },
): Promise<void> {
  const attemptsLeft = call.attemptsLeft ?? recordAttempts;
  const recorded = await positions.record(trade, { signal: call.signal });
  if (recorded.ok) {
    return;
  }
  if (attemptsLeft <= 1) {
    throw new BinferenceError({
      code: "engine.positions_stale",
      message: `The paper fill of ${trade.intentId} kept losing its position write.`,
      retryable: true,
      details: { intent: trade.intentId },
    });
  }
  await recordFill(positions, trade, { ...call, attemptsLeft: attemptsLeft - 1 });
}

// The kinds whose input the paper portfolio must hold at the fill: a sale or a swap of what the
// wallet holds, by amount or by share, which another fill may have sold since the quote.
const spendsHolding: ReadonlySet<IntentRecord["kind"]> = new Set(["sell", "swap"]);

// Whether the wallet's paper portfolio still holds the input the confirmed quote spends.
async function holdsInput(
  options: PaperFillsOptions,
  snapshot: IntentSnapshot,
  call: { readonly quote: QuoteView; readonly signal: AbortSignal },
): Promise<boolean> {
  const { record } = snapshot;
  if (!spendsHolding.has(record.kind)) {
    return true;
  }
  const { amountIn } = call.quote;
  const held = await options.portfolio.balance(record.walletId, amountIn.asset, call);
  return held >= amountIn.base;
}

// A sale whose paper holding fell short ends where the state machine sends it, and moves nothing.
async function endShort(
  options: PaperFillsOptions,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const machine = createIntentStateMachine({ clock: options.clock });
  const step = machine.apply(snapshot.stored.status, { type: "paper_holding_short" });
  if (!step.ok) {
    return snapshot;
  }
  const intent = snapshot.record.id;
  const move = { intent, version: snapshot.stored.version, step: step.value, by: "engine" };
  const moved = await options.stored.move(move, { signal });
  return moved.ok ? moved.value : ((await options.stored.snapshot(intent, { signal })) ?? snapshot);
}

// The move's write on its order: none for a fill of no order, and `undefined` for an order fill
// whose order can no longer record it, which fills nothing (decision 0197).
async function orderPartOf(
  order: ((fill: PaperFill) => Promise<OrderFillWrite | undefined>) | undefined,
  fill: PaperFill,
): Promise<{ readonly order?: OrderFillWrite } | undefined> {
  if (order === undefined) {
    return {};
  }
  const write = await order(fill);
  return write === undefined ? undefined : { order: write };
}

/** Creates the {@link PaperFills} on the state machine, which decides whether an intent fills. */
export function createPaperFills(options: PaperFillsOptions): PaperFills {
  const machine = createIntentStateMachine({ clock: options.clock });
  const { stored } = options;
  return {
    async fillAtQuote(snapshot, { signal, order }) {
      const step = machine.apply(snapshot.stored.status, { type: "paper_fill_recorded" });
      if (!step.ok) {
        return snapshot;
      }
      const quote = confirmedQuote(snapshot);
      if (!(await holdsInput(options, snapshot, { quote, signal }))) {
        return endShort(options, snapshot, signal);
      }
      const prices = withQuotePrice(options.prices, quote);
      const price = await prices.usdPrice(quote.amountIn.asset, { signal });
      if (!price.ok || !isUsablePrice(price.value)) {
        return snapshot;
      }
      const atMs = step.value.event.atMs;
      const fill = {
        amountIn: quote.amountIn,
        amountOut: quote.expectedOut,
        atMs,
        soldPrice: price.value,
      };
      const intent = snapshot.record.id;
      const written = await orderPartOf(order, fill);
      if (written === undefined) {
        return snapshot;
      }
      const move = {
        intent,
        version: snapshot.stored.version,
        step: step.value,
        by: "engine",
        fill,
        ...written,
      };
      const moved = await stored.move(move, { signal });
      if (!moved.ok) {
        return (await stored.snapshot(intent, { signal })) ?? snapshot;
      }
      // A crash here leaves the fill without its positions; `repairPaperFills` records them at
      // the next start from the fill, which keeps its price.
      const trade = paperTrade(snapshot.record, fill, quote.gas.asset);
      await recordFill(options.positions, trade, { signal });
      return moved.value;
    },
  };
}
