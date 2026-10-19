import type { Ratio } from "@binference/core";
import type { QuoteView } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { FillBreach } from "../intents/intent-reason.js";
import type { FillProposal } from "../money-path/authorize-simulated.js";
import { tradeSlippageBps } from "../money-path/swap-trade.js";
import { isUsablePrice } from "../positions/value-execution.js";
import { checkFill } from "./fill-bounds.js";
import type { FillPrice, OrderFillsParts } from "./fill-orders.js";
import type { SizedFill } from "./fill-request.js";
import type { OrderRecord } from "./order-record.js";

// The USD price of the asset across the trade from the token, or none when nothing prices it.
async function otherUsdOf(
  parts: Pick<OrderFillsParts, "prices">,
  call: {
    readonly snapshot: IntentSnapshot;
    readonly side: "buy" | "sell";
    readonly signal: AbortSignal;
  },
): Promise<Ratio | undefined> {
  const { quote } = call.snapshot.record;
  if (quote === undefined) {
    return undefined;
  }
  const view = quoteDocument.decode(quote);
  const other = call.side === "buy" ? view.amountIn.asset : view.minOut.asset;
  const usd = await parts.prices.usdPrice(other, { signal: call.signal });
  return usd.ok && isUsablePrice(usd.value) ? usd.value : undefined;
}

/**
 * The fill's check at `simulated` (decisions 0195 and 0197): the other side's USD price is read
 * before the agent's line; in the line, its order as it stands now is held to every bound with
 * its quote, and a sale sized in dollars to its dollars at its own quote.
 */
export function checkOf(
  parts: OrderFillsParts,
  fill: { readonly order: OrderRecord; readonly sized: SizedFill; readonly price: FillPrice },
): FillProposal["check"] {
  return async (simulated, outside) => {
    const { order } = fill;
    const side = order.request.side;
    const otherUsd = await otherUsdOf(parts, { snapshot: simulated, side, ...outside });
    return async ({ signal }) => checkInLine(parts, { ...fill, simulated, otherUsd, signal });
  };
}

// The fill trades as its order says (invariant 8 for fills): its order's wallet, mode and side, a
// buy paying what its request spends for the order's token, a sale selling the order's token for
// something else.
function holdsShape(
  fill: { readonly order: OrderRecord; readonly sized: SizedFill },
  simulated: IntentSnapshot,
  view: QuoteView,
): boolean {
  const { order, sized } = fill;
  const { record } = simulated;
  const { token, side } = order.request;
  const isOrders =
    record.walletId === order.walletId && record.isPaper === order.isPaper && record.kind === side;
  const isTokens =
    sized.request.kind === "buy"
      ? view.amountIn.asset === sized.request.spend.asset && view.minOut.asset === token
      : view.amountIn.asset === token && view.minOut.asset !== token;
  return isOrders && isTokens && view.expectedOut.asset === view.minOut.asset;
}

// A copy buy the policy valued above its dollars per buy, or did not value, breaks its size
// (decision 0260).
function isOverCopyBuy(order: OrderRecord, simulated: IntentSnapshot): boolean {
  const { request } = order;
  if (request.kind !== "copy" || request.side !== "buy" || !("usdMicros" in request.size)) {
    return false;
  }
  const value = simulated.record.valueUsdMicros;
  return value === undefined || value > request.size.usdMicros;
}

// The order as it stands now, while it has the fills the fill was sized for: a fill it recorded
// since leaves the fill nothing to fill.
async function sameFillOf(
  parts: Pick<OrderFillsParts, "orders">,
  order: OrderRecord,
  signal: AbortSignal,
): Promise<OrderRecord | undefined> {
  const current = await parts.orders.get(order.id, { signal });
  return current?.fills === order.fills ? current : undefined;
}

// The dollars a sale sized in dollars may receive at most; none for any other fill.
function dollarSaleOf(order: OrderRecord): bigint | undefined {
  const { side, size } = order.request;
  return side === "sell" && "usdMicros" in size ? size.usdMicros : undefined;
}

// The check in the agent's line, on the other side's price read before it.
async function checkInLine(
  parts: OrderFillsParts,
  fill: {
    readonly order: OrderRecord;
    readonly sized: SizedFill;
    readonly price: FillPrice;
    readonly simulated: IntentSnapshot;
    readonly otherUsd: Ratio | undefined;
    readonly signal: AbortSignal;
  },
): Promise<FillBreach | undefined> {
  const { order, sized, price, simulated, otherUsd, signal } = fill;
  const current = await sameFillOf(parts, order, signal);
  const { quote } = simulated.record;
  if (current === undefined || quote === undefined) {
    return "order_inactive";
  }
  const view = quoteDocument.decode(quote);
  if (!holdsShape(fill, simulated, view) || isOverCopyBuy(fill.order, simulated)) {
    return "fill_bounds";
  }
  // The agent's maximum for the quote's pair, which holds when the order names none (decision 0197).
  const pair = [view.amountIn.asset, view.minOut.asset];
  const agentSlippageBps = tradeSlippageBps({ pair }, simulated.settings.limits, parts.chains);
  const saleUsd = dollarSaleOf(order);
  const checked = checkFill(
    current,
    {
      amountInBase: view.amountIn.base,
      expectedOutBase: view.expectedOut.base,
      minOutBase: view.minOut.base,
    },
    {
      nowMs: parts.clock.now(),
      limitBase: sized.limitBase,
      tokenDecimals: price.decimals,
      agentSlippageBps,
      ...(otherUsd === undefined ? {} : { otherUsd }),
      ...(price.confirm === undefined ? {} : { confirm: price.confirm }),
      ...(saleUsd === undefined ? {} : { saleUsdMicros: saleUsd }),
    },
  );
  return checked.ok ? undefined : checked.error;
}

// The first fill of a sale in dollars that broke its size: the only one sized again.
function isDollarSaleBreach(order: OrderRecord, snapshot: IntentSnapshot): boolean {
  const { record } = snapshot;
  const isDollarSale = order.request.side === "sell" && "usdMicros" in order.request.size;
  return isDollarSale && record.state === "failed_check" && record.reason === "fill_bounds";
}

// The tokens `usdMicros` buys at a quote's expected price, valued at the other side's price.
function tokensAtQuote(
  usdMicros: bigint,
  quote: { readonly inBase: bigint; readonly outBase: bigint },
  otherUsd: Ratio,
): bigint | undefined {
  const valued = quote.outBase * otherUsd.numerator;
  return valued === 0n ? undefined : (usdMicros * quote.inBase * otherUsd.denominator) / valued;
}

/**
 * A sale sized in dollars sized again at its own quote's price (decision 0197), when its first fill
 * broke its size: the tokens its dollars buy at the quote's expected price, rounded down, never
 * more than the first size. `undefined` for any other fill, or one nothing can price again.
 */
export async function resizedSaleOf(
  parts: Pick<OrderFillsParts, "prices">,
  fill: {
    readonly order: OrderRecord;
    readonly sized: SizedFill;
    readonly snapshot: IntentSnapshot;
    readonly signal: AbortSignal;
  },
): Promise<SizedFill | undefined> {
  const { order, sized, snapshot, signal } = fill;
  const { size } = order.request;
  if (
    !isDollarSaleBreach(order, snapshot) ||
    !("usdMicros" in size) ||
    sized.request.kind !== "sell"
  ) {
    return undefined;
  }
  const otherUsd = await otherUsdOf(parts, { snapshot, side: "sell", signal });
  const view = quoteDocument.decode(snapshot.record.quote ?? null);
  const quote = { inBase: view.amountIn.base, outBase: view.expectedOut.base };
  const base = otherUsd === undefined ? undefined : tokensAtQuote(size.usdMicros, quote, otherUsd);
  const limitBase = base === undefined || base > sized.limitBase ? sized.limitBase : base;
  return base === undefined || limitBase === 0n
    ? undefined
    : { ...sized, request: { ...sized.request, amount: { base: limitBase } }, limitBase };
}
