import { BinferenceError, type BridgeBuildRequest, type TxDraft } from "@binference/plugin-sdk";
import { encodeEvmApproval, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { depositoryOf, evmAddressOf } from "../relay-contracts.js";
import type { RelayOptions } from "../relay-options.js";
import { type QuoteRecord, readQuoteRecord } from "../routes/quote-record.schema.js";
import { type RelayAsk, relayAskOf } from "../routes/route-query.js";
import { encodeDepositErc20 } from "./deposit-call.js";

function refuse(code: `relay.${string}`, message: string): BinferenceError {
  return new BinferenceError({ code, message });
}

// The quote was given for this request: the same wallet, token, amount, recipient, token that
// arrives and destination chain.
function isQuotedFor(record: QuoteRecord, ask: RelayAsk): boolean {
  return (
    record.depositor === ask.depositor &&
    record.tokenIn === ask.tokenIn &&
    record.amount === ask.amount &&
    record.recipient === ask.recipient &&
    record.currencyOut === ask.currencyOut &&
    record.destination === ask.destination.protocol
  );
}

/**
 * Builds a quoted Relay deposit with no further call to Relay: an exact approval of the depository
 * for the input, then `depositErc20` from the request's wallet of exactly its token and amount,
 * naming the order the quote checked (decision 0303). A request the bridge does not take is
 * `relay.no_route`, a quote without its record `relay.bad_quote`, a quote given for another
 * wallet, token, amount, recipient or destination `relay.quote_mismatch`, and a quote whose order
 * pays less than the host's least output `relay.below_min`.
 */
export function buildDeposit(
  request: BridgeBuildRequest,
  options: RelayOptions,
): readonly TxDraft[] {
  const ask = relayAskOf(request, options);
  if (ask === undefined) {
    throw refuse("relay.no_route", "Relay does not bridge this token to this account.");
  }
  const record = readQuoteRecord(request.quote.route);
  if (record === undefined) {
    throw refuse("relay.bad_quote", "The quote carries no order from Relay.");
  }
  if (!isQuotedFor(record, ask)) {
    throw refuse("relay.quote_mismatch", "The quote was given for another bridge than this one.");
  }
  const { minOut } = request;
  if (minOut.asset !== request.deliveredAsset || record.minimumAmount < minOut.base) {
    throw refuse("relay.below_min", "Relay's order pays less than the least output asked.");
  }
  const depository = depositoryOf(request.contracts);
  const approval = encodeEvmApproval({
    wallet: request.wallet,
    token: ask.tokenIn,
    spender: evmAddressOf(depository),
    amountBase: ask.amount,
  });
  const data = encodeDepositErc20({
    depositor: ask.depositor,
    token: ask.tokenIn,
    amount: ask.amount,
    orderId: record.orderId,
  });
  return [approval, encodeEvmDraft({ from: request.wallet, to: depository, value: 0n, data })];
}
