import { publisherOf } from "./decide-install.js";
import type { FetchedPlugin, PluginSource } from "./fetch-plugin.js";
import { declarationsOf } from "./plugin-declarations.js";
import type { PluginListing } from "./plugin-listing.schema.js";
import type { LockedPlugin } from "./plugin-lock.js";

/** The fields of a listing an install compares, in the order it compares them (decision 0433). */
export const listingFields = [
  "packageName",
  "packageVersion",
  "integrity",
  "files",
  "plugin",
  "provenance",
  "publisher",
  "issuer",
  "workflow",
  "kinds",
  "hosts",
  "tools",
  "configKeys",
] as const;

/** A field of a listing that an install compares with what it fetched or installed. */
export type ListingField = (typeof listingFields)[number];

/** What a plugin listing pins of a plugin, as the plugin lock stores it (decision 0434). */
export type ListedFacts = Pick<PluginListing, ListingField>;

/** What a fetched plugin would put in the lock, as a listing pins it. */
export function factsOfFetched(fetched: FetchedPlugin, source: PluginSource): ListedFacts {
  const { publisher, issuer, workflow } = publisherOf(fetched);
  return {
    packageName: source.name,
    packageVersion: source.version,
    integrity: source.integrity,
    files: fetched.pkg.filesHash,
    plugin: fetched.pkg.manifest.id,
    provenance: fetched.provenance.provenance,
    ...(publisher === undefined ? {} : { publisher }),
    ...(issuer === undefined ? {} : { issuer }),
    ...(workflow === undefined ? {} : { workflow }),
    ...declarationsOf(fetched.pkg.manifest),
  };
}

/** What an installed plugin's lock entry holds, as a listing pins it. */
export function factsOfEntry(entry: LockedPlugin): ListedFacts {
  const { publisher, issuer, workflow } = entry;
  return {
    packageName: entry.packageName,
    packageVersion: entry.version,
    integrity: entry.integrity,
    files: entry.hash,
    plugin: entry.id,
    provenance: entry.provenance,
    ...(publisher === undefined ? {} : { publisher }),
    ...(issuer === undefined ? {} : { issuer }),
    ...(workflow === undefined ? {} : { workflow }),
    ...declarationsOf(entry.manifest),
  };
}

// One field's value as text, so a missing value, a name and a list each compare whole.
const textOf = (value: string | readonly string[] | undefined): string =>
  JSON.stringify(value ?? null);

/**
 * The first field, in the order an install compares them, where a listing says another thing of
 * a plugin than it holds; none when every field is equal. A missing publisher, issuer or workflow
 * equals only a missing one, and each list is compared entry by entry, both sorted.
 */
export function listingMismatch(
  listing: PluginListing,
  facts: ListedFacts,
): ListingField | undefined {
  return listingFields.find((field) => textOf(listing[field]) !== textOf(facts[field]));
}
