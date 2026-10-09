import {
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type BuildRequest,
  type TxDraft,
} from "@binference/plugin-sdk";
import { aggregatorTokenOf, encodeEvmApproval, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import type { ChainSetup } from "../chain-setup.js";
import { addressOf, contractOf, executorName, routerName } from "../kyberswap-contracts.js";
import type { VenueParts } from "../venue-parts.js";
import { readSwapCall, withMinReturn } from "./swap-call.js";

// KyberSwap's API takes a slippage from 0 to 2,000 basis points.
const maxApiSlippageBps = 2_000n;
const whole = 10_000n;

function refuse(code: `kyberswap.${string}`, message: string): BinferenceError {
  return new BinferenceError({ code, message });
}

// The slippage the host allowed, rounded up, so the API's own minimum is at most the host's; the
// build then raises the call's minimum to the host's.
function slippageOf(request: BuildRequest): number {
  const expected = request.quote.expectedOut.base;
  const kept = request.minOut.base;
  const lost = kept >= expected ? 0n : ((expected - kept) * whole + expected - 1n) / expected;
  return Number(lost > maxApiSlippageBps ? maxApiSlippageBps : lost);
}

function setupOf(request: BuildRequest, parts: VenueParts): ChainSetup {
  const setup = parts.setups.get(accountRefParts(request.wallet).chain);
  if (setup === undefined) {
    throw refuse("kyberswap.no_chain", "KyberSwap does not trade on the wallet's chain here.");
  }
  return setup;
}

/**
 * Builds a quoted KyberSwap trade: KyberSwap's API encodes the route for the wallet with the host's
 * deadline, the call must go to the registry's router and hand the input to the registry's
 * executor, and its minimum return is raised to the host's when the API's is lower. A token input
 * first gets an exact approval of the router. A quote without its route, or an answer through
 * another router or executor, throws.
 */
export async function buildSwap(
  request: BuildRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<readonly TxDraft[]> {
  signal.throwIfAborted();
  const setup = setupOf(request, parts);
  const [router, executor] = [contractOf(request, routerName), contractOf(request, executorName)];
  const summary = request.quote.route;
  const token = aggregatorTokenOf(request.amountIn.asset, setup);
  if (summary === undefined || token === undefined) {
    throw refuse("kyberswap.no_route", "The quote carries no KyberSwap route for this input.");
  }
  const built = await parts.api.buildRoute(
    {
      slug: setup.slug,
      summary,
      wallet: addressOf(request.wallet),
      deadlineSec: Math.floor(request.deadlineMs / 1000),
      slippageBps: slippageOf(request),
    },
    signal,
  );
  const swap = readSwapCall(built.data, built.transactionValue);
  if (built.routerAddress !== router || swap === undefined || swap.executor !== executor) {
    throw refuse(
      "kyberswap.bad_build",
      "KyberSwap encoded a call outside the registry's contracts.",
    );
  }
  const minReturn = request.minOut.base;
  const trade = encodeEvmDraft({
    from: request.wallet,
    to: accountRefSchema.parse(`${setup.chain}:${router}`),
    value: built.transactionValue,
    data: swap.minReturn >= minReturn ? built.data : withMinReturn(swap, minReturn),
  });
  return request.amountIn.asset === setup.nativeAsset
    ? [trade]
    : [
        encodeEvmApproval({
          wallet: request.wallet,
          token,
          spender: router,
          amountBase: request.amountIn.base,
        }),
        trade,
      ];
}
