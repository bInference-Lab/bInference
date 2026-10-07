import type { Venue } from "@binference/chain";
import { createFakeVenue } from "@binference/chain/testing";

/** A fake venue whose quotes after the first come at half the rate, worse than any tolerance. */
export function worseAfterFirstQuote(): Venue {
  const first = createFakeVenue();
  const later = createFakeVenue({ rate: { numerator: 1n, denominator: 1n } });
  let quotes = 0;
  return {
    ...first,
    async quote(request, options) {
      quotes += 1;
      return (quotes > 1 ? later : first).quote(request, options);
    },
  };
}

/** A fake venue that throws on every quote after the first, as one that went down. */
export function downAfterFirstQuote(): Venue {
  const venue = createFakeVenue();
  let quotes = 0;
  return {
    ...venue,
    async quote(request, options) {
      quotes += 1;
      if (quotes > 1) {
        throw new Error("The venue is down.");
      }
      return venue.quote(request, options);
    },
  };
}

/** The value a test expects to be there; a missing one fails the test. */
export function present<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected a value.");
  }
  return value;
}
