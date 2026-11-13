import { protocolIdSchema } from "@binference/protocol";
import type { InstallDecision } from "./decide-install.js";
import {
  type FetchFailure,
  type FetchedPlugin,
  fetchPlugin,
  type PluginSource,
} from "./fetch-plugin.js";
import { factsOfFetched, listingMismatch } from "./listing-facts.js";
import type { ListingFailure, ListingGate } from "./listing-gate.js";
import type { BundleVerifier } from "./npm-provenance.js";
import type { NpmRegistry } from "./npm-registry.js";
import { failed, type Outcome } from "./outcome.js";
import type { PluginListing } from "./plugin-listing.schema.js";
import type { LockedListing, LockedPlugin } from "./plugin-lock.js";

/** A fetched plugin, with the listing it installs under where the rule needs one. */
export interface ListedFetch {
  readonly fetched: FetchedPlugin;
  readonly listing?: PluginListing;
}

/**
 * Fetches a plugin under the listing rule (decision 0433). With a gate, its listing is read and
 * checked before anything is fetched, so no byte bInference did not review reaches the machine,
 * and what was fetched must then equal the listing field by field (`plugin.listing_mismatch`
 * naming the first that differs). Without one, it is the fetch of decision 0348 alone.
 */
export async function fetchListed(
  parts: {
    readonly registry: NpmRegistry;
    readonly verify: BundleVerifier;
    readonly listing?: ListingGate;
  },
  source: PluginSource,
  signal: AbortSignal,
): Promise<Outcome<ListedFetch, FetchFailure | ListingFailure>> {
  const listed =
    parts.listing === undefined ? undefined : await parts.listing.forPackage(source, signal);
  if (listed?.ok === false) {
    return listed;
  }
  const fetched = await fetchPlugin(parts, source, signal);
  if (!fetched.ok || listed === undefined) {
    return fetched.ok ? { ok: true, value: { fetched: fetched.value } } : fetched;
  }
  const field = listingMismatch(listed.value, factsOfFetched(fetched.value, source));
  return field === undefined
    ? { ok: true, value: { fetched: fetched.value, listing: listed.value } }
    : failed({ code: "plugin.listing_mismatch", field });
}

const lockedOf = (listing: PluginListing): LockedListing => ({
  listing: listing.listing,
  version: listing.version,
});

/**
 * A decision under the listing a plugin installs under: its review names the listing, and the
 * entry it installs records it. Without a listing the decision is as it came.
 */
export function listedDecision(
  decided: InstallDecision,
  listing: PluginListing | undefined,
): InstallDecision {
  if (listing === undefined || decided.kind === "unchanged" || decided.kind === "refused") {
    return decided;
  }
  if (decided.kind === "install") {
    return { ...decided, entry: { ...decided.entry, listing: lockedOf(listing) } };
  }
  const ref = {
    listing: protocolIdSchema("pluginListing").parse(listing.listing),
    version: listing.version,
  };
  return { ...decided, review: { ...decided.review, listing: ref } };
}

/**
 * An entry as the lock's change writes it under the listing rule: off as revoked when the newest
 * revocation list the gate took names its listing now, as one revoked while it installed is
 * (decision 0435); else as it came.
 */
export function withinListing(gate: ListingGate | undefined, entry: LockedPlugin): LockedPlugin {
  const listing = entry.listing?.listing;
  if (gate === undefined || listing === undefined || !gate.isRevoked(listing)) {
    return entry;
  }
  return { ...entry, enabled: false, disabledReason: "revoked" };
}
