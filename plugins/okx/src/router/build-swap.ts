import {
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type BuildRequest,
  type TxDraft,
} from "@binference/plugin-sdk";
import {
  aggregatorNativeToken,
  encodeEvmApproval,
  encodeEvmDraft,
} from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { OkxSwap } from "../api/swap-answer.schema.js";
import { approverName, evmAddressOf, registryAddressOf, routerName } from "../okx-contracts.js";
import { hookedSourcesIn } from "../routes/hooked-sources.js";
import { checkRoute, routeQueryOf } from "../routes/quote-trade.js";
import { readRouteRecord } from "../routes/route-record.schema.js";
import type { VenueParts } from "../venue-parts.js";
import { type DagCall, readDagCall, withTerms } from "./dag-call.js";

const whole = 10_000n;

function refuse(code: `okx.${string}`, message: string): BinferenceError {
  return new BinferenceError({ code, message });
}

// The slippage the host allowed, in percent with two decimals and rounded up, so OKX's own
// minimum is at most the host's; the build then raises the call's minimum to the host's.
function slippagePercentOf(request: BuildRequest): string {
  const expected = request.quote.expectedOut.base;
  const kept = request.minOut.base;
  const lostBps = kept >= expected ? 0n : ((expected - kept) * whole + expected - 1n) / expected;
  const bps = lostBps > whole ? whole : lostBps;
  return `${String(bps / 100n)}.${String(bps % 100n).padStart(2, "0")}`;
}

// The call goes to the registry's router for the wallet, and swaps exactly the trade asked for.
function readCall(swap: OkxSwap, terms: { wallet: Address; router: Address }): DagCall {
  const dag = readDagCall(swap.data, swap.value, terms.wallet);
  const isOwn = swap.to === terms.router && (swap.from ?? terms.wallet) === terms.wallet;
  const isTrade =
    dag !== undefined &&
    dag.recipient === terms.wallet &&
    dag.fromToken === swap.route.tokenIn &&
    dag.toToken === swap.route.tokenOut &&
    dag.amount === swap.route.amountIn;
  if (!isOwn || !isTrade || hookedSourcesIn(swap.route.sources).length > 0) {
    throw refuse("okx.bad_build", "OKX encoded a call the venue does not take.");
  }
  return dag;
}

/**
 * Builds a quoted OKX trade: OKX's API quotes it again and encodes the router call for the
 * wallet, with the DEX ids the quote excluded. The call must go to the registry's router and swap
 * exactly the trade asked for, through no protocol with unchecked hooks; its minimum return is
 * raised to the host's and its deadline brought forward to the host's, where OKX set them looser.
 * A token input first gets an exact approval of OKX's TokenApprove. A quote without its route,
 * no route at build time, or another call throws.
 */
export async function buildSwap(
  request: BuildRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<readonly TxDraft[]> {
  signal.throwIfAborted();
  const query = routeQueryOf(request, parts);
  if (query === undefined) {
    throw refuse("okx.no_route", "OKX does not trade this pair on the wallet's chain here.");
  }
  const { excludedDexIds } = readRouteRecord(request.quote.route);
  const wallet = evmAddressOf(request.wallet);
  const router = registryAddressOf(request, routerName);
  const order = { ...query, excludedDexIds, wallet, slippagePercent: slippagePercentOf(request) };
  const swap = await parts.api.swap(order, signal);
  if (!swap.ok) {
    throw refuse("okx.no_route", "OKX found no route for the quoted trade any more.");
  }
  checkRoute(swap.value.route, query);
  const dag = readCall(swap.value, { wallet, router });
  const minReturn = request.minOut.base > dag.minReturn ? request.minOut.base : dag.minReturn;
  const latestSec = BigInt(Math.floor(request.deadlineMs / 1000));
  const deadlineSec = dag.deadlineSec < latestSec ? dag.deadlineSec : latestSec;
  const trade = encodeEvmDraft({
    from: request.wallet,
    to: accountRefSchema.parse(`${accountRefParts(request.wallet).chain}:${router}`),
    value: swap.value.value,
    data: withTerms(dag, { minReturn, deadlineSec }),
  });
  return query.tokenIn === aggregatorNativeToken
    ? [trade]
    : [
        encodeEvmApproval({
          wallet: request.wallet,
          token: query.tokenIn,
          spender: registryAddressOf(request, approverName),
          amountBase: request.amountIn.base,
        }),
        trade,
      ];
}
