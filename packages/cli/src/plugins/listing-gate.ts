import {
  type Clock,
  createDeadline,
  err,
  type Id,
  type Logger,
  type Result,
} from "@binference/core";
import type { PluginSource } from "./fetch-plugin.js";
import { openEnvelope } from "./listing-envelope.js";
import { factsOfEntry, type ListingField, listingMismatch } from "./listing-facts.js";
import { failed, type Outcome } from "./outcome.js";
import type { PluginListingRule } from "./plugin-listing-rule.js";
import {
  type PluginListing,
  pluginListingSchema,
  type RevocationList,
} from "./plugin-listing.schema.js";
import type { LockedPlugin } from "./plugin-lock.js";
import type { PluginRecords } from "./plugin-records.js";
import type { CatalogFailure } from "./ports.js";
import { createRevocationHolder, type RevocationHolder } from "./revocation-holder.js";

/** Why a plugin's listing did not let it install, turn on or run (decision 0433). */
export type ListingFailure =
  | { readonly code: "plugin.not_listed" }
  | { readonly code: "plugin.listing_unverified" }
  | { readonly code: "plugin.listing_revoked" }
  | { readonly code: "plugin.listing_mismatch"; readonly field: ListingField }
  | {
      readonly code: "plugin.listings_unreachable";
      readonly reason: CatalogFailure | "stale";
    };

/** The listing rule at work: every check of a plugin against its listing and the revocations. */
export interface ListingGate {
  /** The listing of one package version, for an add: verified, not revoked, of the same integrity. */
  forPackage(
    source: PluginSource,
    signal: AbortSignal,
  ): Promise<Outcome<PluginListing, ListingFailure>>;
  /** The listing an installed plugin names, verified, at least its version, equal to its entry. */
  forEntry(
    entry: LockedPlugin,
    signal: AbortSignal,
  ): Promise<Outcome<PluginListing, ListingFailure>>;
  /** Whether the newest revocation list taken names the listing, expired or not. */
  isRevoked(listing: Id<"pls">): boolean;
  /** The revocation list the gate holds and the floor no older list passes. */
  readonly revocations: RevocationHolder;
  /** Reads the catalog's newest revocation list and takes it when it passes. */
  refresh(signal: AbortSignal): Promise<Result<RevocationList, RefreshFailure>>;
}

/** Why no list was taken: the catalog's failure, or `stale` when what it answered had expired. */
type RefreshFailure = CatalogFailure | "stale";

type Required = Extract<PluginListingRule, { readonly kind: "required" }>;

interface GateParts {
  readonly rule: Required;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly holder: RevocationHolder;
  /** Settles once the lock's floor reached the holder, read once before the first take. */
  readonly restored: (signal: AbortSignal) => Promise<void>;
}

/** How long one read of the catalog may take (decision 0433). */
const readLimitMs = 15_000;
/** The most envelopes a package version's `find` may answer; more is `bad_answer`. */
const mostFound = 8;

const unreachable = (reason: CatalogFailure | "stale") =>
  failed({ code: "plugin.listings_unreachable" as const, reason });

// Answers `unreachable` once the signal aborts, whatever the read it races does after.
const givenUp = async <T>(signal: AbortSignal): Promise<Result<T, CatalogFailure>> =>
  new Promise((resolve) => {
    const give = (): void => resolve(err("unreachable"));
    if (signal.aborted) {
      give();
    } else {
      signal.addEventListener("abort", give, { once: true });
    }
  });

// Runs one read of the catalog within the read limit on the clock, and the caller's signal: the
// read is raced against them, so an adapter that drops its signal still answers in 15 seconds.
async function readCatalog<T>(
  parts: GateParts,
  signal: AbortSignal,
  ask: (signal: AbortSignal) => Promise<Result<T, CatalogFailure>>,
): Promise<Result<T, CatalogFailure>> {
  const deadline = createDeadline({ clock: parts.clock, signal, timeoutMs: readLimitMs });
  const read = ask(deadline.signal).catch(() => err("unreachable" as const));
  try {
    return await Promise.race([read, givenUp<T>(deadline.signal)]);
  } finally {
    deadline.clear();
  }
}

async function refresh(
  parts: GateParts,
  signal: AbortSignal,
): Promise<Result<RevocationList, RefreshFailure>> {
  await parts.restored(signal);
  const answer = await readCatalog(parts, signal, async (limit) =>
    parts.rule.catalog.revocations(limit),
  );
  if (!answer.ok) {
    return answer;
  }
  const taken = parts.holder.take(answer.value);
  if (!taken.ok) {
    parts.logger.warn("plugin.revocations_refused", { reason: taken.error });
    return { ok: false, error: taken.error === "expired" ? "stale" : "bad_answer" };
  }
  return taken;
}

// The newest revocation list while it is good, read again from the catalog when none is.
async function freshList(
  parts: GateParts,
  signal: AbortSignal,
): Promise<Outcome<RevocationList, ListingFailure>> {
  const held = parts.holder.fresh();
  if (held !== undefined) {
    return { ok: true, value: held };
  }
  const refreshed = await refresh(parts, signal);
  const list = parts.holder.fresh();
  if (list !== undefined) {
    return { ok: true, value: list };
  }
  return unreachable(refreshed.ok ? "stale" : refreshed.error);
}

// The listings that verify, of the envelopes the catalog answered.
function verified(parts: GateParts, envelopes: readonly string[]): readonly PluginListing[] {
  return envelopes.flatMap((envelope) => {
    const opened = openEnvelope(envelope, { kind: "pluginListing", keys: parts.rule.keys });
    const listing = opened.ok ? pluginListingSchema.safeParse(opened.value.payload) : undefined;
    return listing?.success === true ? [listing.data] : [];
  });
}

// The one listing a package version has: the newest version of one id that names it.
function onlyListing(
  source: PluginSource,
  envelopes: readonly string[],
  listings: readonly PluginListing[],
): Outcome<PluginListing, ListingFailure> {
  if (envelopes.length === 0) {
    return failed({ code: "plugin.not_listed" });
  }
  const [newest] = listings.toSorted((a, b) => b.version - a.version);
  if (newest === undefined) {
    return failed({ code: "plugin.listing_unverified" });
  }
  const isOther = listings.some(
    (listing) =>
      listing.listing !== newest.listing ||
      listing.packageName !== source.name ||
      listing.packageVersion !== source.version,
  );
  return isOther ? unreachable("bad_answer") : { ok: true, value: newest };
}

async function forPackage(parts: GateParts, source: PluginSource, signal: AbortSignal) {
  const list = await freshList(parts, signal);
  if (!list.ok) {
    return list;
  }
  const answer = await readCatalog(parts, signal, async (limit) =>
    parts.rule.catalog.find(source.name, source.version, limit),
  );
  if (!answer.ok) {
    return unreachable(answer.error);
  }
  // More envelopes than one listing's versions could need is refused before any is verified.
  if (answer.value.length > mostFound) {
    return unreachable("bad_answer");
  }
  const listed = onlyListing(source, answer.value, verified(parts, answer.value));
  if (!listed.ok) {
    return listed;
  }
  // A list taken while the catalog read waited counts too.
  const newest = parts.holder.newest() ?? list.value;
  if (newest.revoked.includes(listed.value.listing)) {
    return failed({ code: "plugin.listing_revoked" as const });
  }
  return listed.value.integrity === source.integrity
    ? listed
    : failed({ code: "plugin.listing_mismatch" as const, field: "integrity" as const });
}

// Checks a listing the catalog answered for an installed plugin's entry.
function againstEntry(
  entry: LockedPlugin & { readonly listing: NonNullable<LockedPlugin["listing"]> },
  listing: PluginListing,
  list: RevocationList,
): Outcome<PluginListing, ListingFailure> {
  if (listing.listing !== entry.listing.listing || listing.version < entry.listing.version) {
    return unreachable("bad_answer");
  }
  if (list.revoked.includes(listing.listing)) {
    return failed({ code: "plugin.listing_revoked" });
  }
  const field = listingMismatch(listing, factsOfEntry(entry));
  return field === undefined
    ? { ok: true, value: listing }
    : failed({ code: "plugin.listing_mismatch", field });
}

async function forEntry(parts: GateParts, entry: LockedPlugin, signal: AbortSignal) {
  const { listing } = entry;
  if (listing === undefined) {
    return failed({ code: "plugin.not_listed" as const });
  }
  // A revocation is for good: the lock's mark refuses before the catalog is asked anything.
  if (listing.revoked === true) {
    return failed({ code: "plugin.listing_revoked" as const });
  }
  const list = await freshList(parts, signal);
  if (!list.ok) {
    return list;
  }
  const answer = await readCatalog(parts, signal, async (limit) =>
    parts.rule.catalog.get(listing.listing, limit),
  );
  if (!answer.ok) {
    return unreachable(answer.error);
  }
  if (answer.value === undefined) {
    return failed({ code: "plugin.not_listed" as const });
  }
  const [opened] = verified(parts, [answer.value]);
  // A list taken while the catalog read waited counts too.
  const newest = parts.holder.newest() ?? list.value;
  return opened === undefined
    ? failed({ code: "plugin.listing_unverified" as const })
    : againstEntry({ ...entry, listing }, opened, newest);
}

/**
 * The listing rule's checks for a composition root that requires listings (decisions 0433 and
 * 0435). Every catalog read has 15 seconds; every answer is opened with the root's keys. An add
 * takes the newest listing of its package version; an installed plugin's check takes the newest
 * version of the listing its entry names, never below the entry's, and refuses an entry the lock
 * marks revoked before any read. Each check needs a revocation list still good, read again from
 * the catalog when the held one is not, and is refused by the newest list taken by its end.
 * Before it takes its first list, the gate reads the lock's floor, so it never takes a list older
 * than one taken before a restart (decision 0435).
 */
export function createListingGate(parts: {
  readonly rule: Required;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The plugin lock, whose revocation floor the gate takes before it takes any list. */
  readonly records: PluginRecords;
}): ListingGate {
  const holder = createRevocationHolder({ keys: parts.rule.keys, clock: parts.clock });
  const floorRead: { done: Promise<void> | undefined } = { done: undefined };
  const readFloor = async (signal: AbortSignal): Promise<void> => {
    holder.restore((await parts.records.read(signal)).revocations);
  };
  const restored = async (signal: AbortSignal): Promise<void> => {
    floorRead.done ??= readFloor(signal);
    try {
      await floorRead.done;
    } catch (error) {
      floorRead.done = undefined;
      throw error;
    }
  };
  const { rule, clock, logger } = parts;
  const gate: GateParts = { rule, clock, logger, holder, restored };
  return {
    forPackage: async (source, signal) => forPackage(gate, source, signal),
    forEntry: async (entry, signal) => forEntry(gate, entry, signal),
    isRevoked: (listing) => holder.newest()?.revoked.includes(listing) === true,
    revocations: holder,
    refresh: async (signal) => refresh(gate, signal),
  };
}

/**
 * The listing rule's checks a composition root's rule asks for: none where it needs no listing,
 * so installs run as decision 0348 has them; else a gate on the rule's keys and catalog.
 */
export function listingGateOf(
  rule: PluginListingRule,
  parts: { readonly clock: Clock; readonly logger: Logger; readonly records: PluginRecords },
): ListingGate | undefined {
  return rule.kind === "notRequired" ? undefined : createListingGate({ ...parts, rule });
}
