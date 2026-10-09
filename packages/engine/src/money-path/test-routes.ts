import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";
import type { Ratio } from "@binference/core";

/** The second fake venue's id: a venue on the fake chain beside `fake-swap`. */
export const otherVenueId = "fake-other";

/** The fake venue under {@link otherVenueId}, quoting at `rate` base units out per unit in. */
export function otherVenue(rate: Ratio): Venue {
  return { ...createFakeVenue({ rate }), id: otherVenueId };
}
