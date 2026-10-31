import type { VenueContracts, VenueDeclaration } from "./venue.js";

/**
 * Whether the venue's contracts on one chain are a bridge wallet's alone: it marks a call there as
 * a bridge wallet's, every call it declares there is one, and it names no spender a main wallet
 * approves (decision 0307). The venue declaration refuses an entry that marks some calls so and
 * not others.
 */
export function isBridgeEntry(entry: Omit<VenueContracts, "chain">): boolean {
  const calls = entry.calls ?? [];
  return calls.some((call) => call.onlyWallet === "bridge");
}

/**
 * Whether the venue is a bridge venue, such as Relay: on some chain its contracts are a bridge
 * wallet's alone (see {@link isBridgeEntry}). Only a bridge wallet uses it; its ceiling holds every
 * call each bridge venue the install runs marks, and no main wallet's ceiling holds any.
 */
export function isBridgeVenue(venue: Pick<VenueDeclaration, "contracts">): boolean {
  return venue.contracts.some(isBridgeEntry);
}
