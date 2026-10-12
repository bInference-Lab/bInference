import { poolSource } from "@binference/chain-evm";
import type { PriceCheck } from "@binference/engine/market";
import type { LatestPrice } from "./chain-watch.js";

// A pool shallower than $25,000 is thin: its price needs a check from the last 5 minutes
// (decision 0194).
const thinUsdMicros = 25_000_000_000n;
const thinFreshMs = 300_000;

function isThin(price: LatestPrice): boolean {
  return price.depthUsdMicros === undefined || price.depthUsdMicros < thinUsdMicros;
}

// The checks that speak for this price: of its token and its plan, since that plan priced it.
function checksOf(price: LatestPrice, checks: readonly PriceCheck[]): readonly PriceCheck[] {
  return checks.filter(
    ({ token, plan, atMs }) =>
      token === price.token && plan === price.plan && atMs >= price.planSinceMs,
  );
}

/**
 * Whether a trigger may use a watched price (decision 0194). A launchpad's curve price is
 * confirmed as read: the curve is the token's market. A pool's price is confirmed once a data
 * source found it within the gap limit after that pool was chosen, and no source's last check
 * since found a gap; a pool under $25,000 deep needs such a check from the last 5 minutes.
 */
export function isConfirmed(
  price: LatestPrice,
  checks: readonly PriceCheck[],
  nowMs: number,
): boolean {
  if (price.source !== poolSource) {
    return true;
  }
  const own = checksOf(price, checks);
  if (own.some(({ isGap }) => isGap)) {
    return false;
  }
  const since = isThin(price) ? nowMs - thinFreshMs : price.planSinceMs;
  return own.some(({ atMs }) => atMs >= since);
}

/**
 * Whether the cross-check should check a price first in its sources' next rounds: a pool's price
 * not yet confirmed, or a thin pool's, which must be checked again within 5 minutes.
 */
export function isUrgent(
  price: LatestPrice,
  checks: readonly PriceCheck[],
  nowMs: number,
): boolean {
  return price.source === poolSource && (isThin(price) || !isConfirmed(price, checks, nowMs));
}
