import { BinferenceError, type BridgeBuildRequest, type TxDraft } from "@binference/plugin-sdk";
import { encodeEvmApproval, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { evmAddressOf, spokePoolOf } from "../across-contracts.js";
import type { AcrossOptions } from "../across-options.js";
import type { SwapQuery } from "../api/across-api.js";
import { type DepositRecord, readDepositRecord } from "../routes/deposit-record.schema.js";
import { routeQueryOf } from "../routes/route-query.js";
import { encodeDepositV3 } from "./deposit-call.js";

function refuse(code: `across.${string}`, message: string): BinferenceError {
  return new BinferenceError({ code, message });
}

// The quote was given for this request: the same wallet, recipient, tokens, input and destination.
function isQuotedFor(record: DepositRecord, query: SwapQuery): boolean {
  return (
    record.depositor === query.depositor &&
    record.recipient === query.recipient &&
    record.inputToken === query.inputToken &&
    record.outputToken === query.outputToken &&
    record.inputAmount === query.amount &&
    record.destinationChainId === query.destinationChainId
  );
}

/**
 * Builds a quoted Across deposit with no further call to Across: an exact approval of the SpokePool
 * for the input, then `depositV3` with the request's wallet, recipient, tokens and amount, the
 * quote's own terms from its record, and an empty message (decision 0302). A request the bridge
 * does not take is `across.no_route`, a quote without its record `across.bad_quote`, a quote given
 * for another wallet, recipient, token, amount or destination `across.quote_mismatch`, and a quote
 * whose fill pays less than the host's least output `across.below_min`.
 */
export function buildDeposit(
  request: BridgeBuildRequest,
  options: AcrossOptions,
): readonly TxDraft[] {
  const query = routeQueryOf(request, options)?.query;
  if (query === undefined) {
    throw refuse("across.no_route", "Across does not bridge this token to this account.");
  }
  const record = readDepositRecord(request.quote.route);
  if (record === undefined) {
    throw refuse("across.bad_quote", "The quote carries no deposit terms from Across.");
  }
  if (!isQuotedFor(record, query)) {
    throw refuse("across.quote_mismatch", "The quote was given for another bridge than this one.");
  }
  const { minOut } = request;
  if (minOut.asset !== request.deliveredAsset || record.outputAmount < minOut.base) {
    throw refuse("across.below_min", "Across's quote pays less than the least output asked.");
  }
  const spokePool = spokePoolOf(request.contracts);
  const approval = encodeEvmApproval({
    wallet: request.wallet,
    token: query.inputToken,
    spender: evmAddressOf(spokePool),
    amountBase: query.amount,
  });
  const data = encodeDepositV3({
    ...record,
    depositor: query.depositor,
    recipient: query.recipient,
    inputToken: query.inputToken,
    outputToken: query.outputToken,
    inputAmount: query.amount,
    destinationChainId: query.destinationChainId,
    message: "0x",
  });
  return [approval, encodeEvmDraft({ from: request.wallet, to: spokePool, value: 0n, data })];
}
