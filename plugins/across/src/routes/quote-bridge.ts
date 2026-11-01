import {
  type AccountRef,
  type Amount,
  BinferenceError,
  type BridgeFee,
  type BridgeQuote,
  type BridgeQuoteRequest,
  err,
  ok,
  type NoBridgeRoute,
  type Result,
} from "@binference/plugin-sdk";
import { evmAddressOf, spokePoolOf } from "../across-contracts.js";
import type { AcrossOptions } from "../across-options.js";
import type { AcrossApi } from "../api/across-api.js";
import type { AcrossSwap } from "../api/swap-answer.schema.js";
import { type DepositTerms, readApiDeposit } from "../deposit/deposit-call.js";
import { writeDepositRecord } from "./deposit-record.schema.js";
import { type RoutedQuery, routeQueryOf } from "./route-query.js";

const msPerSecond = 1_000;
// Across's bounds on its own timing, refused beyond them: an exclusivity of at most 10 minutes (every
// recorded one is 0 to 20 seconds), a fill deadline at most 6 hours after the quote (the deadline
// Across's docs recommend), and a quote that holds at most an hour (every recorded one does).
const maxExclusivitySeconds = 600;
const maxFillSeconds = 21_600;
const maxQuoteSeconds = 3_600;

function badQuote(message: string): BinferenceError {
  return new BinferenceError({ code: "across.bad_quote", message });
}

// The answer moves exactly the asked tokens and amount between the asked chains, through the
// SpokePool, with the registry's decimals, and every fee is in the token that leaves.
function isAsked(swap: AcrossSwap, routed: RoutedQuery, spokePool: AccountRef): boolean {
  const { query, route } = routed;
  const { inputToken, outputToken, swapTx, fees } = swap;
  return (
    inputToken.address === query.inputToken &&
    inputToken.chainId === query.originChainId &&
    inputToken.decimals === route.decimals.leaves &&
    outputToken.address === query.askedOutput &&
    outputToken.chainId === query.destinationChainId &&
    outputToken.decimals === route.decimals.arrives &&
    swap.inputAmount === query.amount &&
    swapTx.chainId === query.originChainId &&
    swapTx.to === evmAddressOf(spokePool) &&
    [fees.lp, fees.relayerCapital, fees.destinationGas].every(
      (fee) => fee.token === query.inputToken,
    )
  );
}

// The encoded deposit pays the asked recipient from the wallet, refunds the wallet, moves the
// asked amount to the asked chain and runs nothing on arrival.
function isAskedDeposit(deposit: DepositTerms, routed: RoutedQuery): boolean {
  const { query } = routed;
  return (
    deposit.depositor === query.depositor &&
    deposit.recipient === query.recipient &&
    deposit.inputToken === query.inputToken &&
    deposit.outputToken === query.outputToken &&
    deposit.inputAmount === query.amount &&
    deposit.destinationChainId === query.destinationChainId &&
    deposit.message === "0x"
  );
}

// The input less Across's three fees, in the output token's decimals, rounded down.
function netOutputOf(swap: AcrossSwap): bigint {
  const { lp, relayerCapital, destinationGas } = swap.fees;
  const net = swap.inputAmount - lp.amount - relayerCapital.amount - destinationGas.amount;
  const shift = swap.outputToken.decimals - swap.inputToken.decimals;
  return shift >= 0 ? net * 10n ** BigInt(shift) : net / 10n ** BigInt(-shift);
}

// A direct bridge has no slippage: the deposit's output is Across's least and expected output, and
// exactly the input less the fees it shows, so the fees on a card describe what the relayer keeps.
function isReconciled(deposit: DepositTerms, swap: AcrossSwap): boolean {
  const output = deposit.outputAmount;
  return (
    output > 0n &&
    output === swap.minOutputAmount &&
    output === swap.expectedOutputAmount &&
    output === netOutputOf(swap)
  );
}

// Across's timing stays inside its own documented ranges: a short exclusivity, a fill deadline
// after the quote expires and at most 6 hours out, and a quote that holds at most an hour.
function isTimely(deposit: DepositTerms, swap: AcrossSwap): boolean {
  const { quoteTimestamp, fillDeadline, exclusivityParameter } = deposit;
  const expiry = swap.quoteExpiryTimestamp;
  return (
    exclusivityParameter <= maxExclusivitySeconds &&
    expiry > quoteTimestamp &&
    expiry - quoteTimestamp <= maxQuoteSeconds &&
    fillDeadline > expiry &&
    fillDeadline - quoteTimestamp <= maxFillSeconds
  );
}

function feesOf(swap: AcrossSwap, asset: Amount["asset"]): readonly BridgeFee[] {
  const { lp, relayerCapital, destinationGas } = swap.fees;
  return [
    { kind: "bridge", amount: { asset, base: lp.amount } },
    { kind: "relayer", amount: { asset, base: relayerCapital.amount } },
    { kind: "gas", amount: { asset, base: destinationGas.amount } },
  ];
}

// The answer's deposit, checked against what was asked, its fees and Across's timing bounds.
function checkedDeposit(request: BridgeQuoteRequest, routed: RoutedQuery, swap: AcrossSwap) {
  const deposit = readApiDeposit(swap.swapTx.data);
  if (!isAsked(swap, routed, spokePoolOf(request.contracts))) {
    throw badQuote("Across quoted another bridge than the one asked.");
  }
  if (deposit === undefined || !isAskedDeposit(deposit, routed)) {
    throw badQuote("Across encoded a deposit the bridge does not take.");
  }
  if (!isReconciled(deposit, swap)) {
    throw badQuote("Across's output is not its least output, or not the input less its fees.");
  }
  if (!isTimely(deposit, swap)) {
    throw badQuote("Across's exclusivity, fill deadline or expiry is outside its ranges.");
  }
  return deposit;
}

/**
 * The bridge's quote from a Swap API answer for the query: checked against what was asked, its
 * output reconciled with its fees and its timing bounded, with the deposit's output as the least a
 * fill pays, and what was asked kept in the record beside Across's own terms. Any other answer
 * throws `across.bad_quote`.
 */
function quoteOf(request: BridgeQuoteRequest, routed: RoutedQuery, swap: AcrossSwap): BridgeQuote {
  const deposit = checkedDeposit(request, routed, swap);
  const asset = request.deliveredAsset;
  const { coin } = routed.route;
  return {
    expectedOut: { asset, base: swap.expectedOutputAmount },
    minOut: { asset, base: deposit.outputAmount },
    ...(coin === undefined ? {} : { deliveredAsCoin: coin }),
    fees: feesOf(swap, request.amountIn.asset),
    etaSeconds: swap.expectedFillTime,
    quotedAtMs: deposit.quoteTimestamp * msPerSecond,
    expiresAtMs: swap.quoteExpiryTimestamp * msPerSecond,
    route: writeDepositRecord(deposit),
  };
}

/**
 * Quotes a bridge through Across's Swap API: a request the bridge does not take, or one Across
 * serves now with no direct bridge, is `no_route`; an amount outside the route's limits or its
 * liquidity names which.
 */
export async function quoteBridge(
  request: BridgeQuoteRequest,
  parts: { readonly api: AcrossApi; readonly options: AcrossOptions },
  signal: AbortSignal,
): Promise<Result<BridgeQuote, NoBridgeRoute>> {
  signal.throwIfAborted();
  const routed = routeQueryOf(request, parts.options);
  if (routed === undefined) {
    return err("no_route");
  }
  const swap = await parts.api.swap(routed.query, signal);
  return swap.ok ? ok(quoteOf(request, routed, swap.value)) : swap;
}
