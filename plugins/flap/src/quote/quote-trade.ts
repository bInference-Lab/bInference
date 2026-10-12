import {
  accountRefParts,
  BinferenceError,
  type Bps,
  bpsSchema,
  err,
  ok,
  type QuoteRequest,
  type Result,
  type VenueQuote,
} from "@binference/plugin-sdk";
import { type Address, zeroAddress } from "viem";
import type { ChainSetup } from "../chain-setup.js";
import { flapTokenOf, portalOf } from "../flap-assets.js";
import { type PortalRead, quoteOnPortal, readTokenState } from "../portal/read-portal.js";
import { type TokenState, tokenStatus } from "../portal/token-state.js";
import type { VenueParts } from "../venue-parts.js";
import { curveImpactBps } from "./price-impact.js";

/** A curve trade: the token on the curve, which side it is, and the two addresses it trades. */
interface CurveSide {
  readonly side: "buy" | "sell";
  /** The token on the curve. */
  readonly token: Address;
  /** What the trade pays with or receives: the chain's coin or a quote token the venue serves. */
  readonly quote: Address;
  readonly inputToken: Address;
  readonly outputToken: Address;
}

const noRoute = err("no_route");

// A buy spends the coin or a served quote token on another token; a sale is the reverse. Two
// quote assets, or two tokens neither of which is one, are no curve trade.
function sideOf(request: QuoteRequest, setup: ChainSetup): CurveSide | undefined {
  const inputToken = flapTokenOf(request.amountIn.asset, setup);
  const outputToken = flapTokenOf(request.assetOut, setup);
  if (inputToken === undefined || outputToken === undefined || inputToken === outputToken) {
    return undefined;
  }
  const isQuote = (token: Address) => token === zeroAddress || setup.quoteTokens.has(token);
  const pair = { inputToken, outputToken };
  if (isQuote(inputToken) && !isQuote(outputToken)) {
    return { side: "buy", token: outputToken, quote: inputToken, ...pair };
  }
  return isQuote(outputToken) && !isQuote(inputToken)
    ? { side: "sell", token: inputToken, quote: outputToken, ...pair }
    : undefined;
}

function taxOf(state: TokenState, side: CurveSide["side"]): Bps {
  const tax = side === "buy" ? state.buyTaxBps : state.sellTaxBps;
  const parsed = bpsSchema.safeParse(Number(tax));
  if (tax > 10_000n || !parsed.success) {
    throw new BinferenceError({
      code: "flap.read_failed",
      message: "Flap's Portal reports a tax above the whole trade.",
    });
  }
  return parsed.data;
}

// A buy that would sell the rest of the curve graduates the token in the same call, and the
// Portal hands back the part of the input the curve could not take: the call would not spend
// exactly its input, so the venue does not quote it.
function fillsCurve(state: TokenState, curve: CurveSide, amountOut: bigint): boolean {
  return curve.side === "buy" && state.circulatingSupply + amountOut >= state.dexSupplyThresh;
}

// The Portal's quote of a trade on a curve it holds, with what the venue reports beside it.
async function curveQuote(
  read: PortalRead,
  curve: CurveSide & { readonly state: TokenState },
  request: QuoteRequest,
): Promise<Result<VenueQuote, "no_route">> {
  const { state, inputToken, outputToken } = curve;
  const amountIn = request.amountIn.base;
  const amountOut = await quoteOnPortal(read, { inputToken, outputToken, inputAmount: amountIn });
  if (amountOut === undefined || amountOut === 0n || fillsCurve(state, curve, amountOut)) {
    return noRoute;
  }
  const taxBps = taxOf(state, curve.side);
  const valued = { side: curve.side, amountIn, amountOut, price: state.price };
  return ok({
    expectedOut: { asset: request.assetOut, base: amountOut },
    priceImpactBps: curveImpactBps({ ...valued, taxBps: BigInt(taxBps) }),
    ...(taxBps > 0 ? { taxBps } : {}),
  });
}

/**
 * Quotes a trade on a Flap curve through the Portal's `quoteExactInput`, after reading the token's
 * state: only a token tradable on its curve, against the coin or a quote token the venue serves,
 * and only with that asset. A token that graduated, any other pair, a quote the Portal reverts or
 * that buys nothing, and a buy that would sell the rest of the curve are `no_route`. The quote
 * names the tax the Portal takes on that side, which its output already holds back. A Portal that
 * cannot be read throws.
 */
export async function quoteTrade(
  request: QuoteRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<Result<VenueQuote, "no_route">> {
  signal.throwIfAborted();
  const setup = parts.setups.get(accountRefParts(request.wallet).chain);
  const curve = setup === undefined ? undefined : sideOf(request, setup);
  if (setup === undefined || curve === undefined) {
    return noRoute;
  }
  const read: PortalRead = { rpc: setup.rpc, portal: portalOf(request.contracts), signal };
  const state = await readTokenState(read, curve.token);
  return state?.status === tokenStatus.tradable && state.quoteToken === curve.quote
    ? curveQuote(read, { ...curve, state }, request)
    : noRoute;
}
