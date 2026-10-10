import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import type { Bps, Ratio } from "@binference/core";

/** The second fake venue's id: a venue on the fake chain beside `fake-swap`. */
export const otherVenueId = "fake-other";

/**
 * The fake venue under {@link otherVenueId}, quoting at `rate` base units out per unit in, with
 * the fake venue's price impact unless `priceImpactBps` sets one.
 */
export function otherVenue(rate: Ratio, priceImpactBps?: Bps): Venue {
  const options = priceImpactBps === undefined ? { rate } : { rate, priceImpactBps };
  return { ...createFakeVenue(options), id: otherVenueId };
}
