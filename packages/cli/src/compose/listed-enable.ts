import { BinferenceError, err, type Result } from "@binference/core";
import { isListingRevoked } from "../plugins/listed-install.js";
import type { ListingFailure, ListingGate } from "../plugins/listing-gate.js";
import type { Outcome } from "../plugins/outcome.js";
import type { PluginListing } from "../plugins/plugin-listing.schema.js";
import type { LockedPlugin, PluginLock } from "../plugins/plugin-lock.js";
import { isPluginsFull } from "../plugins/plugin-quota.js";
import { withPlugin } from "../plugins/plugin-records.js";

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
function withListingVersion(entry: LockedPlugin, listing: PluginListing | undefined): LockedPlugin {
  const held = entry.listing;
  if (listing === undefined || held === undefined || listing.version <= held.version) {
    return entry;
  }
  return { ...entry, listing: { listing: held.listing, version: listing.version } };
}

// The entry turned on or off, as the lock holds it when the change is written.
function switched(entry: LockedPlugin, change: { readonly enabled: boolean }): LockedPlugin {
  const { disabledReason: _was, ...rest } = entry;
  return change.enabled
    ? { ...rest, enabled: true }
    : { ...rest, enabled: false, disabledReason: "owner" };
}

/** Why a switch's lock change wrote nothing: the plugins' quota, or a listing revoked since. */
export type SwitchRefusal = "quota" | "revoked";

/** One plugin turned on or off, as the lock change of `plugin/enable` or `disable` writes it. */
interface Switching {
  readonly plugin: string;
  readonly enabled: boolean;
  /** The plugins' quota an enable counts (decision 0431); none for a disable. */
  readonly quota: number | undefined;
  /** The listing an enable's check read, where the composition root needs one. */
  readonly listing: PluginListing | undefined;
}

/**
 * The lock a switch writes, from the lock as its change reads it. An enable is refused, writing
 * nothing, when the lock marks the plugin's listing revoked or the newest list the gate took names
 * it, whatever its check read before (decision 0435), and past the plugins' quota (decision
 * 0431); one that passes takes the listing version its check read (decision 0433).
 */
export function switchedLock(
  at: { readonly gate: ListingGate | undefined; readonly lock: PluginLock },
  switching: Switching,
): { readonly lock: PluginLock; readonly refusal?: SwitchRefusal } {
  const { lock } = at;
  const current = lock.plugins.find(({ plugin }) => plugin === switching.plugin);
  if (current === undefined) {
    return { lock };
  }
  if (switching.enabled && isListingRevoked(at.gate, current)) {
    return { lock, refusal: "revoked" };
  }
  if (switching.enabled && isPluginsFull(lock, current, switching.quota)) {
    return { lock, refusal: "quota" };
  }
  return {
    lock: withPlugin(lock, withListingVersion(switched(current, switching), switching.listing)),
  };
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
