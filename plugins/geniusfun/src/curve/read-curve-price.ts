import {
  err,
  ok,
  type PriceMiss,
  type PriceRead,
  type PriceReadRequest,
  type Ratio,
  type ReadAnswer,
  type Result,
} from "@binference/plugin-sdk";
import { curveAssetOf } from "@binference/plugin-sdk/evm";
import {
  numberOf,
  reservesCallData,
  reservesOf,
  sellableCallData,
} from "../contracts/genius-calls.js";
import { unreadable } from "../contracts/read-genius.js";
import { addressOf, curveAccountOf } from "../geniusfun-contracts.js";
import { standingOf } from "../launch/token-standing.js";
import type { VenueParts } from "../venue-parts.js";

const hexData = /^0x(?:[0-9a-fA-F]{2})+$/;

/**
 * How the price watcher prices a token on its launch's Genius.fun curve each block: the curve's
 * `getReserves()`, whose quote reserve over its token reserve is the curve's price, and its
 * `sellableTokens()`, whose zero means the curve is ready to graduate and the read must change,
 * `replan`. The read is planned from the token's launch now, on the curve the host gave from the
 * venue's curve read (decision 0212): a token no listed stack launched, a graduating launch, one
 * off its curve, or an asset that is no ERC-20 token of a chain the venue trades on is
 * `no_price_read`, so a graduating token waits for its pool unpriced. A curve that is not the
 * token's own, or a contract that cannot be read, throws.
 */
export async function readCurvePrice(
  request: PriceReadRequest,
  parts: VenueParts,
  signal: AbortSignal,
): Promise<Result<PriceRead, "no_price_read">> {
  const standing = await standingOf(request, parts, signal);
  if (standing.kind !== "on_curve") {
    return err("no_price_read");
  }
  const { setup, launch } = standing;
  const curve = curveAccountOf(request.contracts);
  if (addressOf(curve) !== launch.curve) {
    throw unreadable("the curve the host gave is not the token's own.");
  }
  return ok({
    quoteAsset: curveAssetOf(launch.pairToken, setup),
    calls: [
      { target: curve, input: reservesCallData },
      { target: curve, input: sellableCallData },
    ],
    price: curvePrice,
  });
}

// The curve's price in the answers of `getReserves()` and `sellableTokens()`: base units of its
// quote asset for one base unit of the token, while it still sells tokens.
function curvePrice(answers: readonly ReadAnswer[]): Result<Ratio, PriceMiss> {
  const [reserves, sellable, ...rest] = answers;
  const isRead = [reserves, sellable].every(
    (answer) => answer !== undefined && hexData.test(answer),
  );
  if (reserves === undefined || sellable === undefined || rest.length > 0 || !isRead) {
    return err("unpriced");
  }
  try {
    const { quoteReserve, tokenReserve } = reservesOf(`0x${reserves.slice(2)}`);
    // A curve that sells no more tokens is ready to graduate: the read is planned again, and the
    // token waits for its pool unpriced (decision 0179).
    if (numberOf(`0x${sellable.slice(2)}`) === 0n) {
      return err("replan");
    }
    return quoteReserve > 0n && tokenReserve > 0n
      ? ok({ numerator: quoteReserve, denominator: tokenReserve })
      : err("unpriced");
  } catch {
    return err("unpriced");
  }
}
