import {
  assetRefParts,
  err,
  ok,
  type PriceMiss,
  type PriceRead,
  type PriceReadRequest,
  type Ratio,
  type ReadAnswer,
  type Result,
} from "@binference/plugin-sdk";
import type { Address } from "viem";
import { assetOfFlapToken, flapTokenOf, portalAccountOf, portalOf } from "../flap-assets.js";
import { stateCallData, stateOf } from "../portal/portal-calls.js";
import { readTokenState } from "../portal/read-portal.js";
import { tokenStatus } from "../portal/token-state.js";
import type { VenueParts } from "../venue-parts.js";

// The Portal prices a token per whole token, and every Flap token has 18 decimals.
const baseUnitsPerToken = 10n ** 18n;
const hexData = /^0x(?:[0-9a-fA-F]{2})+$/;

// The curve's price in one answer of `getTokenV8Safe`, while the token still trades on the curve
// against the quote token it traded against when the read was planned.
function curvePrice(answers: readonly ReadAnswer[], quoteToken: Address): Result<Ratio, PriceMiss> {
  const [answer, ...rest] = answers;
  if (answer === undefined || rest.length > 0 || !hexData.test(answer)) {
    return err("unpriced");
  }
  try {
    const state = stateOf(`0x${answer.slice(2)}`);
    // A token that left its curve, or trades against another asset now, needs another read.
    if (state.status !== tokenStatus.tradable || state.quoteToken !== quoteToken) {
      return err("replan");
    }
    return state.price > 0n
      ? ok({ numerator: state.price, denominator: baseUnitsPerToken })
      : err("unpriced");
  } catch {
    return err("unpriced");
  }
}

/**
 * How the price watcher prices a token on Flap's curve each block: one `getTokenV8Safe` read of
 * the Portal, whose `price` is the curve's price in base units of its quote asset for one whole
 * token. The read is planned from the token's state now: a token Flap never launched, one that
 * left its curve, or one that is no ERC-20 token of a chain the venue trades on is
 * `no_price_read`. Once the token leaves its curve, or trades against another asset, its answers
 * say `replan`. A Portal that cannot be read throws.
 */
export async function readCurvePrice(
  request: PriceReadRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<Result<PriceRead, "no_price_read">> {
  signal.throwIfAborted();
  const setup = parts.setups.get(assetRefParts(request.token).chain);
  const token = setup === undefined ? undefined : flapTokenOf(request.token, setup);
  if (setup === undefined || token === undefined || request.token === setup.nativeAsset) {
    return err("no_price_read");
  }
  const portal = portalAccountOf(request.contracts);
  const read = { rpc: setup.rpc, portal: portalOf(request.contracts), signal };
  const state = await readTokenState(read, token);
  if (state?.status !== tokenStatus.tradable) {
    return err("no_price_read");
  }
  const { quoteToken } = state;
  return ok({
    quoteAsset: assetOfFlapToken(quoteToken, setup),
    calls: [{ target: portal, input: stateCallData(token) }],
    price: (answers) => curvePrice(answers, quoteToken),
  });
}
