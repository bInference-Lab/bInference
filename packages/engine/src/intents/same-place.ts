import type { TradePlace } from "@binference/protocol";

// The launchpad of a curve place; none for the pools.
function launchpadOf(place: TradePlace): string | undefined {
  return place.kind === "curve" ? place.launchpad : undefined;
}

/**
 * Whether two quotes of one intent trade at the same place: the same launchpad's curve, or the
 * pools. A swap names no place either time, which is the same.
 */
export function isSamePlace(before: TradePlace | undefined, now: TradePlace | undefined): boolean {
  if (before === undefined || now === undefined) {
    return before === now;
  }
  return before.kind === now.kind && launchpadOf(before) === launchpadOf(now);
}
