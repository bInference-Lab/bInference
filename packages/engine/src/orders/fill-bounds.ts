import { applyBps, type Bps, err, mulDiv, ok, type Ratio, type Result } from "@binference/core";
import type { FillSize, OrderRequest } from "@binference/protocol";
import type { FillReason } from "../intents/intent-reason.js";
import { buyFillSpendBase } from "./buy-order-amount.js";
import type { OrderRecord } from "./order-record.js";
import { compareRatios, meetsLevel, type PriceLevel, wholeTokenPrice } from "./price-level.js";

/** What a fill is sized with when its quote is built (spec 6, section 5; decision 0190). */
export interface SizeFacts {
  readonly side: "buy" | "sell";
  /** What the wallet holds of what the fill spends: a buy's spending asset, a sale's token. */
  readonly heldBase: bigint;
  /** What a buy of the chain's coin keeps for network fees; 0 for a token and for a sale. */
  readonly keptBase: bigint;
  /**
   * Micro-dollars for one base unit of what the fill spends, which a size in dollars needs: a
   * buy's spending asset, a sale's token at the fill's price. Absent when nothing prices it.
   */
  readonly spendUsd?: Ratio;
}

/**
 * The most one fill may spend, in base units of what it spends, or `no_price` for a size in
 * dollars that nothing prices. A buy spends `{ base }` as it is, a share of its spendable balance
 * or the dollars at the spending asset's price, each rounded down (decision 0190). A sale sells
 * `{ base }`, a share of what the wallet holds or the dollars at the token's price, never more than
 * the wallet holds (spec 1, section 8.2).
 */
export function fillLimitBase(size: FillSize, facts: SizeFacts): Result<bigint, "no_price"> {
  const { heldBase, keptBase, spendUsd } = facts;
  const isBuy = facts.side === "buy";
  const balance = { balanceBase: heldBase, isChainCoin: keptBase > 0n, gasReserveBase: keptBase };
  if (!("usdMicros" in size)) {
    const limit = isBuy ? buyFillSpendBase(size, balance) : sellBase(size, heldBase);
    return ok(limit ?? 0n);
  }
  if (spendUsd === undefined || spendUsd.numerator <= 0n || spendUsd.denominator <= 0n) {
    return err("no_price");
  }
  const priced = mulDiv(size.usdMicros, invert(spendUsd), "down");
  return ok(isBuy ? priced : least(priced, heldBase));
}

function sellBase(
  size: Exclude<FillSize, { readonly usdMicros: bigint }>,
  heldBase: bigint,
): bigint {
  return "base" in size ? least(size.base, heldBase) : applyBps(heldBase, size.percentBps, "down");
}

const least = (left: bigint, right: bigint): bigint => (left < right ? left : right);

const invert = (ratio: Ratio): Ratio => ({
  numerator: ratio.denominator,
  denominator: ratio.numerator,
});

/** What a fill's chosen quote does: what it spends, and what comes out as expected and at worst. */
export interface FillQuote {
  readonly amountInBase: bigint;
  readonly expectedOutBase: bigint;
  readonly minOutBase: bigint;
}

/** What a fill is judged with at its authorization, besides its order and its quote. */
export interface FillFacts {
  readonly nowMs: number;
  /** The most it may spend, as {@link fillLimitBase} sized it when its quote was built. */
  readonly limitBase: bigint;
  /** The slippage its request asked; absent, the agent's own maximum. */
  readonly maxSlippageBps?: Bps;
  /**
   * Micro-dollars for one base unit of the trade's other side: what a buy spends, what a sale
   * receives. Absent when nothing prices it.
   */
  readonly otherUsd?: Ratio;
  readonly tokenDecimals: number;
  /** The level the quote's own expected price must meet, when a thin pool's price fired the fill. */
  readonly confirm?: PriceLevel;
  /**
   * A sale sized in dollars: what it may receive at most at its quote's expected output, valued at
   * `otherUsd` (decision 0197).
   */
  readonly saleUsdMicros?: bigint;
}

/** The parts of an order a fill is held to. */
export type BoundedOrder = Pick<OrderRecord, "state" | "fills" | "maxFills" | "expiresAtMs"> & {
  readonly request: Pick<OrderRequest, "side" | "worstPrice" | "maxSlippageBps">;
};

// The order may fill now: active, before its expiry, with a fill left.
function canFill(order: BoundedOrder, nowMs: number): boolean {
  const { maxFills } = order;
  return (
    order.state === "active" &&
    nowMs < order.expiresAtMs &&
    (maxFills === undefined || order.fills < maxFills)
  );
}

// A sale sized in dollars takes no more than its dollars at its own quote; nothing values a quote
// whose other side has no price, so such a sale breaks its size.
function isInsideDollars(quote: FillQuote, facts: FillFacts): boolean {
  const { saleUsdMicros, otherUsd } = facts;
  if (saleUsdMicros === undefined) {
    return true;
  }
  return (
    otherUsd !== undefined &&
    quote.expectedOutBase * otherUsd.numerator <= saleUsdMicros * otherUsd.denominator
  );
}

// Inside the size and the slippage the order allows.
function isInsideSize(order: BoundedOrder, quote: FillQuote, facts: FillFacts): boolean {
  const most = order.request.maxSlippageBps;
  const asked = facts.maxSlippageBps;
  const isSlippageInside = most === undefined || (asked !== undefined && asked <= most);
  const isInsideBase = quote.amountInBase > 0n && quote.amountInBase <= facts.limitBase;
  return isInsideBase && isSlippageInside && isInsideDollars(quote, facts);
}

/**
 * A quote's price in micro-dollars per whole token, at the output given: what a buy pays for each
 * token it gets, what a sale gets for each token it sells. `undefined` when the other side has no
 * USD price or no token changes hands.
 */
export function quotePrice(
  side: "buy" | "sell",
  amounts: { readonly inBase: bigint; readonly outBase: bigint },
  facts: Pick<FillFacts, "otherUsd" | "tokenDecimals">,
): Ratio | undefined {
  const { otherUsd, tokenDecimals } = facts;
  const [otherBase, tokenBase] =
    side === "buy" ? [amounts.inBase, amounts.outBase] : [amounts.outBase, amounts.inBase];
  if (otherUsd === undefined || otherUsd.denominator <= 0n || tokenBase <= 0n) {
    return undefined;
  }
  const perBaseUnit = {
    numerator: otherBase * otherUsd.numerator,
    denominator: tokenBase * otherUsd.denominator,
  };
  return wholeTokenPrice(perBaseUnit, tokenDecimals);
}

// The quote's price at its minimum out is no worse than the order's worst price: a buy pays at
// most it, a sale gets at least it.
function holdsWorstPrice(order: BoundedOrder, quote: FillQuote, facts: FillFacts): boolean {
  const { worstPrice, side } = order.request;
  if (worstPrice === undefined) {
    return true;
  }
  const price = quotePrice(side, { inBase: quote.amountInBase, outBase: quote.minOutBase }, facts);
  if (price === undefined) {
    return false;
  }
  const compared = compareRatios(price, { numerator: worstPrice, denominator: 1n });
  return side === "buy" ? compared <= 0 : compared >= 0;
}

function isConfirmed(order: BoundedOrder, quote: FillQuote, facts: FillFacts): boolean {
  const { confirm } = facts;
  if (confirm === undefined) {
    return true;
  }
  const amounts = { inBase: quote.amountInBase, outBase: quote.expectedOutBase };
  const price = quotePrice(order.request.side, amounts, facts);
  return price !== undefined && meetsLevel(price, confirm);
}

/**
 * Holds a fill to its order's bounds at its authorization (spec 6, section 5), and names the first
 * it breaks: `order_inactive` for an order that is not active, has expired or used its last fill;
 * `fill_bounds` for a fill that spends nothing, more than its size allows or more slippage than
 * the order's maximum; `worst_price` for a quote whose price at its minimum out is worse than the
 * order's worst price, or that nothing can value; `trigger_unconfirmed` for a quote whose own
 * expected price does not meet the level it must confirm.
 */
export function checkFill(
  order: BoundedOrder,
  quote: FillQuote,
  facts: FillFacts,
): Result<undefined, FillReason> {
  if (!canFill(order, facts.nowMs)) {
    return err("order_inactive");
  }
  if (!isInsideSize(order, quote, facts)) {
    return err("fill_bounds");
  }
  if (!holdsWorstPrice(order, quote, facts)) {
    return err("worst_price");
  }
  return isConfirmed(order, quote, facts) ? ok(undefined) : err("trigger_unconfirmed");
}
