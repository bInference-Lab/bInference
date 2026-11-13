import { BinferenceError, err, type Result } from "@binference/core";
import type { ListingFailure, ListingGate } from "../plugins/listing-gate.js";
import type { Outcome } from "../plugins/outcome.js";
import type { PluginListing } from "../plugins/plugin-listing.schema.js";
import type { LockedPlugin } from "../plugins/plugin-lock.js";

/**
 * The listing an enable turns a plugin on under (decision 0433): checked by the gate before the
 * quota is read, or none where the composition root needs no listing.
 */
export async function enableListing(
  gate: ListingGate | undefined,
  entry: LockedPlugin,
  signal: AbortSignal,
): Promise<Outcome<PluginListing | undefined, ListingFailure>> {
  return gate === undefined ? { ok: true, value: undefined } : gate.forEntry(entry, signal);
}

/** An entry turned on with the newest listing version its check read, never a lower one. */
export function withListingVersion(
  entry: LockedPlugin,
  listing: PluginListing | undefined,
): LockedPlugin {
  const held = entry.listing;
  if (listing === undefined || held === undefined || listing.version <= held.version) {
    return entry;
  }
  return { ...entry, listing: { listing: held.listing, version: listing.version } };
}

/**
 * What `plugin/enable` answers for a listing that kept the plugin off: its code, or, for a field
 * that differs or a catalog that could not be read, a fault that names it, the second retryable.
 */
export function refusedEnable(
  failure: ListingFailure,
): Result<never, "plugin.not_listed" | "plugin.listing_unverified" | "plugin.listing_revoked"> {
  if (failure.code === "plugin.listing_mismatch") {
    throw new BinferenceError({
      code: failure.code,
      message: "The plugin is not what its listing says.",
      details: { field: failure.field },
    });
  }
  if (failure.code === "plugin.listings_unreachable") {
    throw new BinferenceError({
      code: failure.code,
      message: "The plugin listings could not be checked.",
      retryable: true,
      details: { reason: failure.reason },
    });
  }
  return err(failure.code);
}
