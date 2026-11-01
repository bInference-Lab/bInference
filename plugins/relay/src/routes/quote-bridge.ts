import {
  BinferenceError,
  type BridgeFee,
  type BridgeQuote,
  type BridgeQuoteRequest,
  err,
  type NoBridgeRoute,
  ok,
  type Result,
} from "@binference/plugin-sdk";
import type { RelayQuote } from "../api/quote-answer.schema.js";
import type { RelayApi } from "../api/relay-api.js";
import { orderProblemOf } from "../order/check-order.js";
import { isSignedBySolver } from "../order/order-signature.js";
import { depositoryOf, evmAddressOf } from "../relay-contracts.js";
import type { RelayOptions } from "../relay-options.js";
import { writeQuoteRecord } from "./quote-record.schema.js";
import { quoteBodyOf, quoteTtlSeconds, type RelayAsk, relayAskOf } from "./route-query.js";

const msPerSecond = 1_000;
// A quote holds until 5 minutes before Relay's time to live ends, so a deposit signed at its last
// moment still lands and is filled before Relay would refund it (decision 0322).
const quoteHoldsMs = (quoteTtlSeconds - 300) * msPerSecond;

function badQuote(problem: string): BinferenceError {
  return new BinferenceError({
    code: "relay.bad_quote",
    message: `Relay quoted another bridge than the one asked (${problem}).`,
    details: { problem },
  });
}

function unsignedOrder(): BinferenceError {
  return new BinferenceError({
    code: "relay.unsigned_order",
    message: "Relay's answer carries no order signed by Relay's solver, so the bridge takes none.",
  });
}

function feesOf(quote: RelayQuote, asset: BridgeQuoteRequest["amountIn"]["asset"]) {
  const fees: readonly BridgeFee[] = [
    { kind: "relayer", amount: { asset, base: quote.fees.relayerService.amount } },
    { kind: "gas", amount: { asset, base: quote.fees.relayerGas.amount } },
  ];
  return fees;
}

/**
 * The bridge's quote from a Relay answer for what it asked: checked against the ask and the
 * registry's depository (`orderProblemOf`), with the order's least output as the least a fill
 * pays, Relay's solver fees, its time estimate, and what was asked kept in the record beside the
 * order. An order that would no longer be fillable when the quote expires, or any other answer,
 * throws `relay.bad_quote`.
 */
function quoteOf(
  request: BridgeQuoteRequest,
  parts: { readonly ask: RelayAsk; readonly answer: RelayQuote; readonly quotedAtMs: number },
): BridgeQuote {
  const { ask, answer, quotedAtMs } = parts;
  const problem = orderProblemOf(answer, ask, evmAddressOf(depositoryOf(request.contracts)));
  if (problem !== undefined) {
    throw badQuote(problem);
  }
  const expiresAtMs = quotedAtMs + quoteHoldsMs;
  if (answer.order.output.deadline * msPerSecond < expiresAtMs) {
    throw badQuote("short_deadline");
  }
  const asset = request.deliveredAsset;
  const { minimumAmount, expectedAmount } = answer.order.output;
  const record = {
    depositor: ask.depositor,
    tokenIn: ask.tokenIn,
    amount: ask.amount,
    recipient: ask.recipient,
    currencyOut: ask.currencyOut,
    destination: ask.destination.protocol,
    orderId: answer.orderId,
    minimumAmount,
  };
  return {
    expectedOut: { asset, base: expectedAmount },
    minOut: { asset, base: minimumAmount },
    fees: feesOf(answer, request.amountIn.asset),
    etaSeconds: answer.timeEstimate,
    quotedAtMs,
    expiresAtMs,
    route: writeQuoteRecord(record),
  };
}

/**
 * Quotes a bridge through Relay's API: a request the bridge does not take is `no_route` and asks
 * Relay nothing; an amount outside the route's limits or its solvers' liquidity names which. An
 * answer whose order id Relay's solver did not sign throws `relay.unsigned_order` before any other
 * check, so a card never shows an order only the API vouches for.
 */
export async function quoteBridge(
  request: BridgeQuoteRequest,
  parts: { readonly api: RelayApi; readonly options: RelayOptions },
  signal: AbortSignal,
): Promise<Result<BridgeQuote, NoBridgeRoute>> {
  signal.throwIfAborted();
  const ask = relayAskOf(request, parts.options);
  if (ask === undefined) {
    return err("no_route");
  }
  const answer = await parts.api.quote(quoteBodyOf(ask), signal);
  if (!answer.ok) {
    return answer;
  }
  if (!(await isSignedBySolver(answer.value.orderId, answer.value.orderSignature))) {
    throw unsignedOrder();
  }
  const quotedAtMs = parts.options.clock.now();
  return ok(quoteOf(request, { ask, answer: answer.value, quotedAtMs }));
}
